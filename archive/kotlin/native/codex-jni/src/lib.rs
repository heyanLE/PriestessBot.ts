//! JNI boundary around the fork's public in-process Codex engine.

use std::collections::HashMap;
use std::future::Future;
use std::panic::{AssertUnwindSafe, catch_unwind};
use std::sync::atomic::{AtomicBool, AtomicI64, Ordering};
use std::sync::{Arc, Mutex, OnceLock};
use std::sync::mpsc::sync_channel;
use std::time::Duration;

use anyhow::{Result, anyhow};
use codex_astrbot::engine::{Engine, EngineOptions, ReviewRequest, ThreadParams, TurnRequest};
use codex_protocol::dynamic_tools::DynamicToolResponse;
use jni::JNIEnv;
use jni::objects::{JObject, JString};
use jni::sys::{jint, jlong, jstring};
use serde_json::{Value, json};
use tokio::runtime::{Builder, Runtime};
use tokio::sync::mpsc::{self, Receiver};

const THREAD_STACK_BYTES: usize = 16 * 1024 * 1024;
const MAX_JSON_BYTES: usize = 16 * 1024 * 1024;
const MAX_WORKER_WAIT: Duration = Duration::from_secs(120);
static NEXT_HANDLE: AtomicI64 = AtomicI64::new(1);
static ENGINES: OnceLock<Mutex<HashMap<i64, Arc<NativeEngine>>>> = OnceLock::new();

fn engines() -> &'static Mutex<HashMap<i64, Arc<NativeEngine>>> {
    ENGINES.get_or_init(|| Mutex::new(HashMap::new()))
}

/// Codex's deep async stack must run on a Rust worker with the configured 16 MiB stack,
/// never on a JVM executor thread (typically only 2 MiB on macOS).
fn run_on_worker<T, F>(runtime: &Runtime, future: F) -> Result<T>
where
    T: Send + 'static,
    F: Future<Output = Result<T>> + Send + 'static,
{
    let (sender, receiver) = sync_channel(1);
    runtime.spawn(async move { let _ = sender.send(future.await); });
    receiver.recv_timeout(MAX_WORKER_WAIT)
        .map_err(|_| anyhow!("Codex worker did not reply within the native deadline"))?
}

enum NativeEvent {
    Event(Value),
    Closed,
    Failed,
}

struct EventInbox {
    receiver: Receiver<NativeEvent>,
    pending: Option<(u64, NativeEvent)>,
    next_sequence: u64,
}

struct NativeEngine {
    runtime: Runtime,
    engine: Arc<Engine>,
    events: Mutex<HashMap<String, Arc<Mutex<EventInbox>>>>,
    closed: AtomicBool,
}

impl NativeEngine {
    fn new(options: EngineOptions) -> Result<Self> {
        let runtime = Builder::new_multi_thread()
            .enable_all()
            .thread_stack_size(THREAD_STACK_BYTES)
            .thread_name("priestess-codex")
            .build()?;
        let engine = Arc::new(run_on_worker(&runtime, Engine::new(options))?);
        Ok(Self { runtime, engine, events: Mutex::new(HashMap::new()), closed: AtomicBool::new(false) })
    }

    fn register_thread(&self, info: &Value) -> Result<()> {
        let thread_id = info.get("thread_id").and_then(Value::as_str)
            .ok_or_else(|| anyhow!("native thread has no id"))?.to_owned();
        let manager = Arc::clone(&self.engine);
        let id = thread_id.clone();
        let thread = run_on_worker(&self.runtime, async move { manager.thread(&id).await })?;
        let (sender, receiver) = mpsc::channel(128);
        let mut events = self.events.lock().map_err(|_| anyhow!("event registry unavailable"))?;
        if events.contains_key(&thread_id) {
            return Err(anyhow!("thread already has an event pump"));
        }
        events.insert(thread_id, Arc::new(Mutex::new(EventInbox {
            receiver, pending: None, next_sequence: 1,
        })));
        self.runtime.spawn(async move {
            loop {
                match Engine::next_event(Arc::clone(&thread)).await {
                    Ok(Some(event)) => {
                        if sender.send(NativeEvent::Event(event)).await.is_err() { break; }
                    }
                    Ok(None) => { let _ = sender.send(NativeEvent::Closed).await; break; }
                    Err(_) => { let _ = sender.send(NativeEvent::Failed).await; break; }
                }
            }
        });
        Ok(())
    }

    fn poll_event(&self, thread_id: &str, timeout_millis: i32) -> Result<String> {
        let inbox = self.events.lock().map_err(|_| anyhow!("event registry unavailable"))?
            .get(thread_id).cloned().ok_or_else(|| anyhow!("unknown thread"))?;
        let timeout = Duration::from_millis(timeout_millis.clamp(0, 5000) as u64);
        let mut inbox = inbox.lock().map_err(|_| anyhow!("event receiver unavailable"))?;
        if inbox.pending.is_none() {
            let event = match self.runtime.block_on(async {
                tokio::time::timeout(timeout, inbox.receiver.recv()).await
            }) {
                Ok(Some(event)) => event,
                Ok(None) => NativeEvent::Closed,
                Err(_) => return Ok(json!({"status":"timeout"}).to_string()),
            };
            let sequence = inbox.next_sequence;
            inbox.next_sequence = inbox.next_sequence.checked_add(1).ok_or_else(|| anyhow!("event sequence exhausted"))?;
            inbox.pending = Some((sequence, event));
        }
        let (sequence, event) = inbox.pending.as_ref().ok_or_else(|| anyhow!("missing pending event"))?;
        Ok(match event {
            NativeEvent::Event(value) => json!({"status":"event","sequence":sequence,"event":value}),
            NativeEvent::Closed => json!({"status":"closed","sequence":sequence}),
            NativeEvent::Failed => json!({"status":"failed","sequence":sequence}),
        }.to_string())
    }

    fn ack_event(&self, thread_id: &str, sequence: u64) -> Result<()> {
        let inbox = self.events.lock().map_err(|_| anyhow!("event registry unavailable"))?
            .get(thread_id).cloned().ok_or_else(|| anyhow!("unknown thread"))?;
        let mut inbox = inbox.lock().map_err(|_| anyhow!("event receiver unavailable"))?;
        if inbox.pending.as_ref().map(|(pending, _)| *pending) != Some(sequence) {
            return Err(anyhow!("event acknowledgement is stale"));
        }
        inbox.pending = None;
        Ok(())
    }
}

fn engine(handle: jlong) -> Result<Arc<NativeEngine>> {
    let native = engines().lock().map_err(|_| anyhow!("native engine registry unavailable"))?
        .get(&handle).cloned().ok_or_else(|| anyhow!("invalid native engine handle"))?;
    if native.closed.load(Ordering::Acquire) { return Err(anyhow!("native engine is closed")); }
    Ok(native)
}

fn string(env: &mut JNIEnv<'_>, value: JString<'_>) -> Result<String> {
    let value: String = env.get_string(&value)?.into();
    if value.len() > MAX_JSON_BYTES { return Err(anyhow!("native JSON input is too large")); }
    Ok(value)
}

fn fail(env: &mut JNIEnv<'_>) {
    // Never format a native error into the JVM exception: provider errors can contain credentials.
    let _ = env.throw_new("java/lang/IllegalStateException", "Codex native operation failed");
}

fn call_string(env: &mut JNIEnv<'_>, work: impl FnOnce(&mut JNIEnv<'_>) -> Result<String>) -> jstring {
    match catch_unwind(AssertUnwindSafe(|| work(env))) {
        Ok(Ok(value)) if value.len() <= MAX_JSON_BYTES => match env.new_string(value) {
            Ok(value) => value.into_raw(),
            Err(_) => { fail(env); std::ptr::null_mut() }
        },
        _ => { fail(env); std::ptr::null_mut() }
    }
}

fn call_void(env: &mut JNIEnv<'_>, work: impl FnOnce(&mut JNIEnv<'_>) -> Result<()>) {
    if !matches!(catch_unwind(AssertUnwindSafe(|| work(env))), Ok(Ok(()))) { fail(env); }
}

#[no_mangle]
pub extern "system" fn Java_com_heyanle_priestess_bot_agent_codex_CodexNativeBridge_create(
    mut env: JNIEnv<'_>, _self: JObject<'_>, options: JString<'_>,
) -> jlong {
    match catch_unwind(AssertUnwindSafe(|| -> Result<jlong> {
        let options: EngineOptions = serde_json::from_str(&string(&mut env, options)?)?;
        let native = Arc::new(NativeEngine::new(options)?);
        let handle = NEXT_HANDLE.fetch_add(1, Ordering::Relaxed);
        engines().lock().map_err(|_| anyhow!("native engine registry unavailable"))?.insert(handle, native);
        Ok(handle)
    })) {
        Ok(Ok(handle)) => handle,
        _ => { fail(&mut env); 0 }
    }
}

#[no_mangle]
pub extern "system" fn Java_com_heyanle_priestess_bot_agent_codex_CodexNativeBridge_startThread(
    mut env: JNIEnv<'_>, _self: JObject<'_>, handle: jlong, params: JString<'_>,
) -> jstring {
    call_string(&mut env, |env| {
        let params: ThreadParams = serde_json::from_str(&string(env, params)?)?;
        let native = engine(handle)?;
        let engine = Arc::clone(&native.engine);
        let info = run_on_worker(&native.runtime, async move { engine.start_thread(params).await })?;
        native.register_thread(&info)?;
        Ok(info.to_string())
    })
}

#[no_mangle]
pub extern "system" fn Java_com_heyanle_priestess_bot_agent_codex_CodexNativeBridge_resumeThread(
    mut env: JNIEnv<'_>, _self: JObject<'_>, handle: jlong, params: JString<'_>,
) -> jstring {
    call_string(&mut env, |env| {
        let params: ThreadParams = serde_json::from_str(&string(env, params)?)?;
        let native = engine(handle)?;
        let engine = Arc::clone(&native.engine);
        let info = run_on_worker(&native.runtime, async move { engine.resume_thread(params).await })?;
        native.register_thread(&info)?;
        Ok(info.to_string())
    })
}

#[no_mangle]
pub extern "system" fn Java_com_heyanle_priestess_bot_agent_codex_CodexNativeBridge_submitTurn(
    mut env: JNIEnv<'_>, _self: JObject<'_>, handle: jlong, thread_id: JString<'_>, request: JString<'_>,
) -> jstring {
    call_string(&mut env, |env| {
        let thread_id = string(env, thread_id)?;
        let request: TurnRequest = serde_json::from_str(&string(env, request)?)?;
        let native = engine(handle)?;
        let engine = Arc::clone(&native.engine);
        Ok(run_on_worker(&native.runtime, async move { engine.submit_turn(&thread_id, request).await })?.to_string())
    })
}

#[no_mangle]
pub extern "system" fn Java_com_heyanle_priestess_bot_agent_codex_CodexNativeBridge_threadUsage(
    mut env: JNIEnv<'_>, _self: JObject<'_>, handle: jlong, thread_id: JString<'_>,
) -> jstring {
    call_string(&mut env, |env| {
        let thread_id = string(env, thread_id)?;
        let native = engine(handle)?;
        let engine = Arc::clone(&native.engine);
        Ok(run_on_worker(&native.runtime, async move { engine.thread_usage(&thread_id).await })?.to_string())
    })
}

#[no_mangle]
pub extern "system" fn Java_com_heyanle_priestess_bot_agent_codex_CodexNativeBridge_pollEvent(
    mut env: JNIEnv<'_>, _self: JObject<'_>, handle: jlong, thread_id: JString<'_>, timeout_millis: jint,
) -> jstring {
    call_string(&mut env, |env| engine(handle)?.poll_event(&string(env, thread_id)?, timeout_millis))
}

#[no_mangle]
pub extern "system" fn Java_com_heyanle_priestess_bot_agent_codex_CodexNativeBridge_ackEvent(
    mut env: JNIEnv<'_>, _self: JObject<'_>, handle: jlong, thread_id: JString<'_>, sequence: jlong,
) {
    call_void(&mut env, |env| {
        let thread_id = string(env, thread_id)?;
        let sequence = u64::try_from(sequence).map_err(|_| anyhow!("invalid event sequence"))?;
        engine(handle)?.ack_event(&thread_id, sequence)
    });
}

#[no_mangle]
pub extern "system" fn Java_com_heyanle_priestess_bot_agent_codex_CodexNativeBridge_dynamicToolResponse(
    mut env: JNIEnv<'_>, _self: JObject<'_>, handle: jlong, thread_id: JString<'_>, call_id: JString<'_>, response: JString<'_>,
) {
    call_void(&mut env, |env| {
        let thread_id = string(env, thread_id)?;
        let call_id = string(env, call_id)?;
        let response: DynamicToolResponse = serde_json::from_str(&string(env, response)?)?;
        let native = engine(handle)?;
        let engine = Arc::clone(&native.engine);
        run_on_worker(&native.runtime, async move { engine.dynamic_tool_response(&thread_id, call_id, response).await })
    });
}

#[no_mangle]
pub extern "system" fn Java_com_heyanle_priestess_bot_agent_codex_CodexNativeBridge_reviewDecision(
    mut env: JNIEnv<'_>, _self: JObject<'_>, handle: jlong, thread_id: JString<'_>, request: JString<'_>,
) {
    call_void(&mut env, |env| {
        let thread_id = string(env, thread_id)?;
        let request: ReviewRequest = serde_json::from_str(&string(env, request)?)?;
        let native = engine(handle)?;
        let engine = Arc::clone(&native.engine);
        run_on_worker(&native.runtime, async move { engine.review_decision(&thread_id, request).await })
    });
}

#[no_mangle]
pub extern "system" fn Java_com_heyanle_priestess_bot_agent_codex_CodexNativeBridge_interrupt(
    mut env: JNIEnv<'_>, _self: JObject<'_>, handle: jlong, thread_id: JString<'_>,
) {
    call_void(&mut env, |env| {
        let thread_id = string(env, thread_id)?;
        let native = engine(handle)?;
        let engine = Arc::clone(&native.engine);
        run_on_worker(&native.runtime, async move { engine.interrupt(&thread_id).await })
    });
}

#[no_mangle]
pub extern "system" fn Java_com_heyanle_priestess_bot_agent_codex_CodexNativeBridge_close(
    mut env: JNIEnv<'_>, _self: JObject<'_>, handle: jlong,
) {
    call_void(&mut env, |_| {
        let native = engines().lock().map_err(|_| anyhow!("native engine registry unavailable"))?
            .remove(&handle).ok_or_else(|| anyhow!("invalid native engine handle"))?;
        native.closed.store(true, Ordering::Release);
        let engine = Arc::clone(&native.engine);
        run_on_worker(&native.runtime, async move { engine.shutdown().await })
    });
}
