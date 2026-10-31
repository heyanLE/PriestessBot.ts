"use strict";
(() => {
  (() => {
    const root = document.getElementById("priestess-prototype");
    if (!(root instanceof HTMLElement)) throw new Error("Prototype root missing");
    const app = root;
    function get(selector) {
      const result = app.querySelector(selector);
      if (!(result instanceof HTMLElement)) throw new Error(`Missing element: ${selector}`);
      return result;
    }
    function inputValue(selector) {
      const element = get(selector);
      if (element instanceof HTMLInputElement || element instanceof HTMLTextAreaElement || element instanceof HTMLSelectElement) return element.value;
      throw new Error(`Not an input: ${selector}`);
    }
    function escape(text) {
      return String(text).replaceAll("&", "&amp;").replaceAll("<", "&lt;").replaceAll(">", "&gt;").replaceAll('"', "&quot;").replaceAll("'", "&#39;");
    }
    function icon(name) {
      return `<i data-lucide="${name}" aria-hidden="true"></i>`;
    }
    function icons() {
      if (typeof lucide !== "undefined") lucide.createIcons({ attrs: { width: 19, height: 19 } });
    }
    const logo = app.querySelector(".px-brand img");
    const logoUrl = logo instanceof HTMLImageElement ? logo.src : "";
    const initial = {
      personaName: "\u666E\u745E\u8D5B\u65AF",
      persona: "\u4F60\u662F\u666E\u745E\u8D5B\u65AF\uFF0C\u4E00\u4F4D\u51B7\u9759\u3001\u53EF\u9760\u7684\u52A9\u624B\u3002\n\u56DE\u7B54\u76F4\u63A5\u6E05\u695A\uFF0C\u5FC5\u8981\u65F6\u4E3B\u52A8\u67E5\u8BC1\u3002\n\u6267\u884C\u4EFB\u52A1\u540E\uFF0C\u6839\u636E\u5B9E\u9645\u7ED3\u679C\u8BF4\u660E\u5B8C\u6210\u60C5\u51B5\u3002",
      examples: [{ user: "\u5E2E\u6211\u67E5\u4E00\u4E0B\u8FD9\u4E2A\u578B\u53F7\u7684\u663E\u793A\u5668\u3002", assistant: "\u53EF\u4EE5\u3002\u628A\u578B\u53F7\u6216\u56FE\u7247\u53D1\u7ED9\u6211\uFF0C\u6211\u4F1A\u6838\u5BF9\u53C2\u6570\u548C\u4EF7\u683C\u3002" }],
      model: "DeepSeek Chat",
      extra: "",
      search: true,
      command: false,
      files: true,
      knowledge: false,
      memory: true,
      compress: true,
      turns: 20,
      state: "normal",
      approval: true
    };
    let draft = structuredClone(initial);
    let published = structuredClone(initial);
    let page = "agent";
    let tab = "persona";
    let revision = 1;
    let attachment = "";
    let chatBusy = false;
    let chatGeneration = 0;
    const models = ["DeepSeek Chat", "GPT-4.1", "\u672C\u5730\u6A21\u578B\uFF08\u793A\u4F8B\uFF09"];
    const stateLabels = { normal: "\u666E\u901A\u5E72\u5458", senior: "\u8D44\u6DF1\u5E72\u5458", elite: "\u9AD8\u7EA7\u8D44\u6DF1\u5E72\u5458" };
    let messages = [
      { role: "user", content: "\u5E2E\u6211\u641C\u4E00\u4E0B\u8FD9\u6B3E\u663E\u793A\u5668" },
      { role: "assistant", content: "\u8BF7\u53D1\u6765\u578B\u53F7\u6216\u56FE\u7247\uFF0C\u6211\u4F1A\u5148\u786E\u8BA4\u5177\u4F53\u6B3E\u5F0F\uFF0C\u518D\u6838\u5BF9\u53C2\u6570\u3002", trace: ["\u793A\u4F8B\u6D88\u606F \u2192 \u666E\u745E\u8D5B\u65AF", "\u4EBA\u683C\uFF1A\u666E\u745E\u8D5B\u65AF\uFF1B\u6A21\u578B\uFF1ADeepSeek Chat", "\u5F53\u524D\u4FE1\u606F\u4E0D\u8DB3\uFF0C\u5148\u786E\u8BA4\u578B\u53F7", "\u8FD9\u662F\u9884\u8BBE\u6A21\u62DF\u56DE\u590D\uFF0C\u672A\u8C03\u7528\u6A21\u578B\u6216\u641C\u7D22\u670D\u52A1"] }
    ];
    const robots = [{ name: "QQ \u65E5\u5E38\u52A9\u624B", platform: "NapCat", trigger: "\u63D0\u53CA\u6216\u56DE\u590D\u673A\u5668\u4EBA", scope: "\u793A\u4F8B\u7FA4 10001", state: "\u666E\u901A\u5E72\u5458", enabled: true }];
    let wizard = null;
    let connectionTestGeneration = 0;
    let connectionTestBusy = false;
    function isDirty() {
      return JSON.stringify(draft) !== JSON.stringify(published);
    }
    function notice(text, error = false) {
      const box = get("#px-notice");
      box.textContent = text;
      box.dataset["error"] = String(error);
      box.hidden = false;
    }
    function syncDraftStatus() {
      const dirty = isDirty();
      const status = get("#px-draft-status");
      status.textContent = dirty ? "\u6709\u672A\u53D1\u5E03\u4FEE\u6539" : `\u5F53\u524D\u5DF2\u53D1\u5E03 \xB7 v${revision}`;
      status.dataset["dirty"] = String(dirty);
      for (const id of ["#px-publish", "#px-discard"]) {
        const button = get(id);
        if (button instanceof HTMLButtonElement) button.disabled = !dirty;
      }
      get("#px-test-config").textContent = `${draft.model} \xB7 ${stateLabels[draft.state]} \xB7 ${draft.search ? "\u53EF\u641C\u7D22" : "\u641C\u7D22\u672A\u542F\u7528"} \xB7 \u4EC5\u6A21\u62DF`;
    }
    function fieldsChanged() {
      const changes = [];
      if (draft.persona !== published.persona || draft.personaName !== published.personaName) changes.push(`\u4EBA\u683C\u8BBE\u5B9A\uFF1A${draft.personaName}`);
      if (JSON.stringify(draft.examples) !== JSON.stringify(published.examples)) changes.push(`\u793A\u4F8B\u5BF9\u8BDD\uFF1A${draft.examples.length} \u7EC4`);
      if (draft.model !== published.model) changes.push(`\u6A21\u578B\uFF1A${published.model} \u2192 ${draft.model}`);
      if (draft.extra !== published.extra) changes.push("\u9AD8\u7EA7\u8865\u5145\u6307\u4EE4");
      if (["search", "command", "files", "knowledge"].some((key) => {
        switch (key) {
          case "search":
            return draft.search !== published.search;
          case "command":
            return draft.command !== published.command;
          case "files":
            return draft.files !== published.files;
          default:
            return draft.knowledge !== published.knowledge;
        }
      })) changes.push("\u5DE5\u5177\u4E0E\u77E5\u8BC6\u5E93\u7ED1\u5B9A");
      if (draft.memory !== published.memory || draft.compress !== published.compress || draft.turns !== published.turns) changes.push("\u4E0A\u4E0B\u6587\u4E0E\u8BB0\u5FC6\u7B56\u7565");
      if (draft.state !== published.state || draft.approval !== published.approval) changes.push(`\u6743\u9650\u4E0E\u5BA1\u6279\uFF1A${stateLabels[draft.state]}`);
      return changes;
    }
    function checkbox(name, label, description, checked) {
      return `<label class="px-tool-row"><input type="checkbox" name="${name}" ${checked ? "checked" : ""}><span><strong>${label}</strong><small>${description}</small></span></label>`;
    }
    function option(value, selected, label = value) {
      return `<option value="${escape(value)}" ${value === selected ? "selected" : ""}>${escape(label)}</option>`;
    }
    function renderEditor() {
      get("#px-editor").innerHTML = tab === "persona" ? `
      <h2>\u4EBA\u683C</h2>
      <div class="px-field-row"><label for="px-persona-choice">\u5F53\u524D\u4EBA\u683C</label><button id="px-persona-choice" type="button" data-action="personas">${escape(draft.personaName)} \xB7 \u5F53\u524D Agent \u4E13\u7528 ${icon("chevron-down")}</button><button class="px-text-button" type="button" data-action="personas">\u4ECE\u4EBA\u683C\u5E93\u9009\u62E9</button></div>
      <label>\u89D2\u8272\u8BBE\u5B9A<textarea name="persona" rows="5" maxlength="4000">${escape(draft.persona)}</textarea></label>
      <div class="px-form-section"><div class="px-section-heading"><h3>\u793A\u4F8B\u5BF9\u8BDD</h3><button type="button" class="px-text-button px-push-right" data-action="add-example">${icon("plus")}\u6DFB\u52A0\u793A\u4F8B</button></div>
      ${draft.examples.length ? draft.examples.map((example, index) => `<div class="px-example"><div class="px-example-fields"><label>\u7528\u6237<textarea rows="1" name="example-user" data-index="${index}" aria-label="\u793A\u4F8B ${index + 1} \u7528\u6237" maxlength="1000">${escape(example.user)}</textarea></label><label>\u52A9\u624B<textarea rows="2" name="example-assistant" data-index="${index}" aria-label="\u793A\u4F8B ${index + 1} \u52A9\u624B" maxlength="1500">${escape(example.assistant)}</textarea></label></div><div class="px-example-footer"><button type="button" class="px-quiet" data-action="remove-example" data-index="${index}">\u5220\u9664\u8FD9\u7EC4</button></div></div>`).join("") : '<p class="px-muted">\u8FD8\u6CA1\u6709\u793A\u4F8B\u3002\u6DFB\u52A0\u4E00\u7EC4\u5BF9\u8BDD\uFF0C\u8BF4\u660E\u4F60\u5E0C\u671B\u7684\u56DE\u590D\u65B9\u5F0F\u3002</p>'}</div>
      <div class="px-form-section"><h3>\u6A21\u578B</h3><div class="px-field-row"><label for="px-model">\u9009\u62E9\u6A21\u578B</label><select id="px-model" name="model">${models.map((model) => option(model, draft.model)).join("")}</select><button type="button" class="px-text-button" data-action="models">\u7BA1\u7406\u8FDE\u63A5</button></div><p class="px-muted">\u7528\u4E8E\u56DE\u590D\u4E0E\u5DE5\u5177\u8C03\u7528\u3002</p></div>
      <details><summary>\u9AD8\u7EA7\u8865\u5145\u6307\u4EE4</summary><label><span class="px-muted">\u5728\u89D2\u8272\u8BBE\u5B9A\u4E4B\u5916\uFF0C\u8865\u5145\u4EFB\u52A1\u4E0E\u6267\u884C\u8981\u6C42\u3002</span><textarea name="extra" rows="3" maxlength="1500" placeholder="\u4F8B\u5982\uFF1A\u4EFB\u52A1\u7ED3\u675F\u65F6\u8BF4\u660E\u5B9E\u9645\u5B8C\u6210\u60C5\u51B5\u3002">${escape(draft.extra)}</textarea></label></details>
    ` : tab === "tools" ? `
      <div class="px-section-heading"><h2>\u80FD\u529B\u4E0E\u8D44\u6599</h2></div><p class="px-muted">\u9009\u62E9\u8FD9\u4E2A Agent \u53EF\u4EE5\u4F7F\u7528\u7684\u5DE5\u5177\u3002\u5B9E\u9645\u8C03\u7528\u4ECD\u53D7\u5F53\u524D\u53D1\u9001\u8005\u6743\u9650\u9650\u5236\u3002</p>
      ${checkbox("search", "\u7F51\u7EDC\u641C\u7D22", "\u68C0\u7D22\u7F51\u9875\u4E0E\u8BFB\u53D6\u6B63\u6587 \xB7 \u4F7F\u7528\u793A\u4F8B\u641C\u7D22\u8FDE\u63A5", draft.search)}
      ${checkbox("files", "\u6587\u4EF6\u4E0E\u7FA4\u6587\u4EF6", "\u8BFB\u53D6\u83B7\u51C6\u76EE\u5F55\uFF0C\u5904\u7406\u5F15\u7528\u56FE\u7247\u4E0E\u7FA4\u6587\u4EF6", draft.files)}
      ${checkbox("command", "\u6267\u884C\u547D\u4EE4", "\u5728 Docker \u6C99\u7BB1\u5185\u8FD0\u884C\u4EFB\u52A1 \xB7 \u9700\u8981\u8D44\u6DF1\u5E72\u5458\u53CA\u4EE5\u4E0A", draft.command)}
      ${checkbox("knowledge", "\u9879\u76EE\u8D44\u6599\u5E93", "\u68C0\u7D22\u5DF2\u7ED1\u5B9A\u77E5\u8BC6\u5E93\u4E2D\u7684\u6587\u6863", draft.knowledge)}
      <div class="px-hint">${draft.command ? draft.state === "normal" ? "\u547D\u4EE4\u5DE5\u5177\u5DF2\u88C5\u914D\uFF0C\u4F46\u5F53\u524D\u666E\u901A\u5E72\u5458\u6D4B\u8BD5\u8EAB\u4EFD\u6CA1\u6709\u6267\u884C\u6743\u9650\u3002" : "\u547D\u4EE4\u5DE5\u5177\u53EF\u7528\u3002\u9700\u8981\u5BA1\u6279\u65F6\uFF0C\u4F1A\u5148\u5C55\u793A\u5BA1\u6279\u64CD\u4F5C\u3002" : "\u547D\u4EE4\u5DE5\u5177\u5C1A\u672A\u88C5\u914D\u3002\u542F\u7528\u540E\u53EF\u4EE5\u5230\u53F3\u4FA7\u6D4B\u8BD5\u201C\u6267\u884C\u4E00\u4E2A\u547D\u4EE4\u201D\u3002"}</div>
      <button type="button" data-tab="permissions">\u67E5\u770B\u5F53\u524D\u6743\u9650 ${icon("arrow-right")}</button>
      <div class="px-form-section"><h3>\u66F4\u591A\u8D44\u6E90</h3><div class="px-list-row"><div>Skills \u4E0E MCP<small>\u4F7F\u7528\u540C\u4E00\u8D44\u6E90\u9009\u62E9\u65B9\u5F0F\u88C5\u914D\u80FD\u529B\u3002</small></div><button type="button" data-page="resources">\u6D4F\u89C8\u8D44\u6E90\u5E93</button></div></div>
    ` : tab === "context" ? `
      <h2>\u4E0A\u4E0B\u6587\u4E0E\u8BB0\u5FC6</h2><p class="px-muted" style="margin-top:10px">\u628A\u77ED\u671F\u5BF9\u8BDD\u548C\u957F\u671F\u8BB0\u5FC6\u5206\u5F00\u8BBE\u7F6E\u3002</p>
      <div class="px-form-section"><label>\u4FDD\u7559\u6700\u8FD1\u591A\u5C11\u8F6E\u5BF9\u8BDD<input type="number" name="turns" min="1" max="100" value="${draft.turns}"></label></div>
      ${checkbox("compress", "\u81EA\u52A8\u538B\u7F29\u5386\u53F2", "\u63A5\u8FD1\u4E0A\u4E0B\u6587\u4E0A\u9650\u65F6\u6574\u7406\u8F83\u65E9\u7684\u5BF9\u8BDD", draft.compress)}
      ${checkbox("memory", "\u542F\u7528\u957F\u671F\u8BB0\u5FC6", "\u6309\u53D1\u9001\u8005\u548C\u4F1A\u8BDD\u8303\u56F4\u68C0\u7D22\uFF0C\u4E0D\u81EA\u52A8\u5171\u4EAB\u4E0D\u540C\u7FA4\u804A\u7684\u8BB0\u5FC6", draft.memory)}
      <div class="px-hint">\u5F53\u524D\u7B56\u7565\uFF1A\u6700\u8FD1 ${draft.turns} \u8F6E \xB7 ${draft.compress ? "\u81EA\u52A8\u538B\u7F29" : "\u4E0D\u81EA\u52A8\u538B\u7F29"} \xB7 ${draft.memory ? "\u53EC\u56DE\u957F\u671F\u8BB0\u5FC6" : "\u4E0D\u53EC\u56DE\u957F\u671F\u8BB0\u5FC6"}\u3002\u6B64\u5904\u53EA\u6A21\u62DF\u8BBE\u7F6E\u4E0E\u53D1\u5E03\u3002</div>
      <button type="button" data-action="memory">\u67E5\u770B\u793A\u4F8B\u8BB0\u5FC6</button>
    ` : `
      <h2>\u6743\u9650\u4E0E\u6267\u884C</h2><p class="px-muted" style="margin-top:10px">\u4EE5\u4E00\u4E2A\u660E\u786E\u8EAB\u4EFD\u68C0\u67E5\u201C\u4E3A\u4EC0\u4E48\u80FD\u7528\u6216\u4E0D\u80FD\u7528\u201D\u3002</p>
      <div class="px-form-section"><label>\u6D4B\u8BD5\u8EAB\u4EFD\u7684\u8FD0\u884C\u6001<select name="state">${Object.entries(stateLabels).map(([key, label]) => option(key, draft.state, label)).join("")}</select></label></div>
      <div class="px-hint"><strong>\u5F53\u524D\u751F\u6548\uFF1A${stateLabels[draft.state]}</strong><br>\u7F51\u7EDC\u641C\u7D22\uFF1A${draft.search ? "\u5141\u8BB8" : "\u672A\u88C5\u914D"}<br>\u6267\u884C\u547D\u4EE4\uFF1A${!draft.command ? "\u672A\u88C5\u914D\u5DE5\u5177" : draft.state === "normal" ? "\u7981\u6B62\uFF0C\u9650\u5236\u6765\u81EA\u53D1\u9001\u8005\u8FD0\u884C\u6001" : "\u5141\u8BB8\uFF0C\u53D7\u6C99\u7BB1\u4E0E\u5BA1\u6279\u9650\u5236"}</div>
      ${checkbox("approval", "\u547D\u4EE4\u6267\u884C\u524D\u9700\u8981\u5BA1\u6279", "\u5728\u5B9E\u9645\u6267\u884C\u4E4B\u524D\uFF0C\u7531\u7BA1\u7406\u8005\u786E\u8BA4\u672C\u6B21\u64CD\u4F5C", draft.approval)}
      <p class="px-muted" style="margin-top:20px">\u8FD0\u884C\u6001\u3001Agent \u80FD\u529B\u3001\u8D44\u6E90\u8303\u56F4\u5171\u540C\u51B3\u5B9A\u6743\u9650\u3002\u8FD9\u662F\u6A21\u62DF\u8EAB\u4EFD\uFF0C\u4E0D\u4F1A\u4FEE\u6539\u771F\u5B9E\u7FA4\u6210\u5458\u6388\u6743\u3002</p>
    `;
      for (const button of app.querySelectorAll(".px-tabs button")) {
        if (button.dataset["tab"] === tab) button.setAttribute("aria-current", "page");
        else button.removeAttribute("aria-current");
      }
      icons();
      syncDraftStatus();
    }
    function renderChat() {
      get("#px-chat").innerHTML = messages.length ? messages.map((message) => message.role === "user" ? `<div class="px-message px-message-user"><p class="px-bubble">${escape(message.content)}</p></div>` : `<div class="px-message"><img src="${logoUrl}" alt="\u666E\u745E\u8D5B\u65AF"><div class="px-message-body"><p class="px-bubble">${escape(message.content)}</p>${message.trace ? `<details><summary>\u67E5\u770B\u6267\u884C\u8FC7\u7A0B\uFF08\u6A21\u62DF\uFF09</summary><ol>${message.trace.map((line) => `<li>${escape(line)}</li>`).join("")}</ol></details>` : ""}</div></div>`).join("") : '<p class="px-muted">\u53EF\u4EE5\u8BD5\u8BD5\u201C\u641C\u7D22\u663E\u793A\u5668\u201D\uFF0C\u6216\u5148\u5173\u95ED\u7F51\u7EDC\u641C\u7D22\uFF0C\u89C2\u5BDF\u7ED3\u679C\u53D8\u5316\u3002</p>';
      if (chatBusy) get("#px-chat").insertAdjacentHTML("beforeend", '<p class="px-muted" role="status">\u6B63\u5728\u6A21\u62DF\u5904\u7406\u2026</p>');
      const send = get("#px-send");
      if (send instanceof HTMLButtonElement) send.disabled = chatBusy;
    }
    function simulateReply(text, config, file) {
      const trace = [`\u8BFB\u53D6\u5F53\u524D\u8349\u7A3F\uFF1A${config.personaName} / ${config.model}`, `\u4EE5${stateLabels[config.state]}\u8FDB\u884C\u6743\u9650\u68C0\u67E5`, "\u9884\u8BBE\u89C4\u5219\u6A21\u62DF\uFF0C\u672A\u8C03\u7528\u771F\u5B9E\u6A21\u578B\u6216\u5DE5\u5177"];
      let content;
      if (/执行|命令|脚本|下载/.test(text)) {
        if (!config.command) {
          content = "\u6A21\u62DF\u7ED3\u679C\uFF1A\u6267\u884C\u547D\u4EE4\u5DE5\u5177\u5C1A\u672A\u88C5\u914D\u3002\u8BF7\u5728\u201C\u80FD\u529B\u4E0E\u8D44\u6599\u201D\u4E2D\u542F\u7528\u540E\u518D\u6D4B\u8BD5\u3002";
          trace.push("\u505C\u6B62\u539F\u56E0\uFF1AAgent \u672A\u88C5\u914D\u547D\u4EE4\u5DE5\u5177");
        } else if (config.state === "normal") {
          content = "\u6A21\u62DF\u7ED3\u679C\uFF1A\u5F53\u524D\u662F\u666E\u901A\u5E72\u5458\uFF0C\u65E0\u6CD5\u6267\u884C\u547D\u4EE4\u3002\u5DE5\u5177\u5DF2\u7ECF\u88C5\u914D\uFF0C\u9650\u5236\u6765\u81EA\u53D1\u9001\u8005\u8FD0\u884C\u6001\u3002";
          trace.push("\u6388\u6743\u62D2\u7EDD\uFF1A\u9700\u8981\u8D44\u6DF1\u5E72\u5458\u53CA\u4EE5\u4E0A");
        } else if (config.approval) {
          content = "\u6A21\u62DF\u7ED3\u679C\uFF1A\u6743\u9650\u68C0\u67E5\u901A\u8FC7\uFF0C\u63A5\u4E0B\u6765\u9700\u8981\u7BA1\u7406\u5458\u5BA1\u6279\u3002\u672C\u539F\u578B\u4E0D\u4F1A\u6267\u884C\u4EFB\u4F55\u771F\u5B9E\u547D\u4EE4\u3002";
          trace.push("\u7B49\u5F85\u7BA1\u7406\u5458\u5BA1\u6279 \u2192 \u5BA1\u6279\u540E\u624D\u5141\u8BB8\u6267\u884C");
        } else {
          content = "\u6A21\u62DF\u7ED3\u679C\uFF1A\u547D\u4EE4\u5DE5\u5177\u3001\u8FD0\u884C\u6001\u4E0E\u6C99\u7BB1\u8303\u56F4\u68C0\u67E5\u901A\u8FC7\u3002\u6B63\u5F0F\u8FD0\u884C\u65F6\u5C06\u8FDB\u5165\u9694\u79BB\u73AF\u5883\u6267\u884C\u3002";
          trace.push("\u547D\u4EE4\u6267\u884C\uFF08\u6A21\u62DF\uFF09\u2192 \u6C47\u603B\u7ED3\u679C");
        }
      } else if (/搜|查|显示器|价格/.test(text)) {
        if (!config.search) {
          content = "\u6A21\u62DF\u7ED3\u679C\uFF1A\u7F51\u7EDC\u641C\u7D22\u672A\u542F\u7528\u3002\u8BF7\u5728\u201C\u80FD\u529B\u4E0E\u8D44\u6599\u201D\u4E2D\u5F00\u542F\u7F51\u7EDC\u641C\u7D22\uFF0C\u518D\u53D1\u4E00\u6B21\u6D88\u606F\u3002";
          trace.push("\u505C\u6B62\u539F\u56E0\uFF1AAgent \u672A\u88C5\u914D\u7F51\u7EDC\u641C\u7D22");
        } else {
          content = file ? `\u6A21\u62DF\u7ED3\u679C\uFF1A\u5DF2\u9009\u62E9\u9644\u4EF6\u201C${file}\u201D\u3002\u6B63\u5F0F\u6D41\u7A0B\u4F1A\u8BC6\u522B\u578B\u53F7\uFF0C\u518D\u67E5\u8BE2\u53C2\u6570\u4E0E\u4EF7\u683C\uFF1B\u672C\u539F\u578B\u53EA\u663E\u793A\u6587\u4EF6\u540D\uFF0C\u4E0D\u8BFB\u53D6\u6587\u4EF6\u5185\u5BB9\u3002` : "\u6A21\u62DF\u7ED3\u679C\uFF1A\u7F51\u7EDC\u641C\u7D22\u53EF\u7528\u3002\u6B63\u5F0F\u6D41\u7A0B\u4F1A\u5148\u786E\u8BA4\u5177\u4F53\u578B\u53F7\uFF0C\u518D\u641C\u7D22\u53C2\u6570\u548C\u4EF7\u683C\uFF0C\u5E76\u9644\u4E0A\u6765\u6E90\u3002";
          trace.push("\u641C\u7D22\u5DE5\u5177\u53EF\u7528 \u2192 \u786E\u8BA4\u578B\u53F7 \u2192 \u68C0\u7D22\u4E0E\u6838\u5BF9 \u2192 \u9644\u4E0A\u6765\u6E90");
        }
      } else if (/记忆|记住/.test(text)) {
        content = config.memory ? "\u6A21\u62DF\u7ED3\u679C\uFF1A\u957F\u671F\u8BB0\u5FC6\u5DF2\u542F\u7528\u3002\u8FD9\u6761\u5185\u5BB9\u5C06\u6309\u53D1\u9001\u8005\u6216\u4F1A\u8BDD\u8303\u56F4\u5904\u7406\uFF0C\u907F\u514D\u8DE8\u7FA4\u5171\u4EAB\u3002" : "\u6A21\u62DF\u7ED3\u679C\uFF1A\u957F\u671F\u8BB0\u5FC6\u5DF2\u5173\u95ED\uFF0C\u8FD9\u6761\u6D88\u606F\u53EA\u8FDB\u5165\u5F53\u524D\u6D4B\u8BD5\u5BF9\u8BDD\u3002";
        trace.push(config.memory ? "\u4F7F\u7528\u5F53\u524D\u4F1A\u8BDD\u8303\u56F4\u7684\u8BB0\u5FC6\u7B56\u7565" : "\u8DF3\u8FC7\u957F\u671F\u8BB0\u5FC6");
      } else {
        content = `\u6A21\u62DF\u7ED3\u679C\uFF1A\u6B63\u5728\u4F7F\u7528\u201C${config.personaName}\u201D\u4E0E ${config.model}\u3002
\u89D2\u8272\u8BBE\u5B9A\uFF1A${config.persona.slice(0, 90)}${config.persona.length > 90 ? "\u2026" : ""}
\u793A\u4F8B\u5BF9\u8BDD\uFF1A${config.examples.length} \u7EC4\u3002\u6B63\u5F0F\u7248\u672C\u5C06\u5728\u8FD9\u91CC\u8FD4\u56DE\u6A21\u578B\u56DE\u590D\u3002`;
      }
      return { role: "assistant", content, trace };
    }
    function openDialog(title, html) {
      get("#px-dialog-title").textContent = title;
      get("#px-dialog-content").innerHTML = html;
      const dialog = get("#px-dialog");
      if (dialog instanceof HTMLDialogElement && !dialog.open) dialog.showModal();
      icons();
    }
    function closeDialog() {
      const dialog = get("#px-dialog");
      if (dialog instanceof HTMLDialogElement) dialog.close();
    }
    function personasDialog() {
      openDialog("\u9009\u62E9\u4EBA\u683C", `<p class="px-muted">\u9009\u62E9\u540E\u590D\u5236\u5230\u5F53\u524D Agent \u8349\u7A3F\uFF0C\u53EF\u7EE7\u7EED\u4FEE\u6539\uFF1B\u4E0D\u4F1A\u6539\u52A8\u5171\u4EAB\u4EBA\u683C\u3002</p><button class="px-dialog-choice" type="button" data-persona="priestess"><strong>\u666E\u745E\u8D5B\u65AF</strong><small>\u51B7\u9759\u3001\u53EF\u9760\uFF1B\u56DE\u7B54\u76F4\u63A5\uFF1B\u6839\u636E\u5B9E\u9645\u7ED3\u679C\u6C47\u62A5\u3002</small></button><button class="px-dialog-choice" type="button" data-persona="research"><strong>\u7814\u7A76\u52A9\u624B</strong><small>\u5148\u6838\u5BF9\u8BC1\u636E\uFF0C\u518D\u7ED9\u7ED3\u8BBA\uFF1B\u6E05\u695A\u6807\u6CE8\u6765\u6E90\u4E0E\u4E0D\u786E\u5B9A\u6027\u3002</small></button><button class="px-dialog-choice" type="button" data-persona="companion"><strong>\u65E5\u5E38\u4F19\u4F34</strong><small>\u81EA\u7136\u3001\u7B80\u6D01\uFF1B\u5148\u7406\u89E3\u9700\u6C42\uFF0C\u518D\u534F\u52A9\u5B8C\u6210\u3002</small></button>`);
    }
    function modelDialog() {
      openDialog("\u6A21\u578B\u8FDE\u63A5", `<p class="px-muted">\u9009\u62E9\u4E00\u4E2A\u793A\u4F8B\u8FDE\u63A5\uFF0C\u4E5F\u53EF\u4EE5\u6A21\u62DF\u6DFB\u52A0\u65B0\u8FDE\u63A5\u3002</p>${models.map((model, index) => `<button class="px-dialog-choice" type="button" data-model="${index}"><strong>${escape(model)}</strong><small>${model === draft.model ? "\u5F53\u524D Agent \u5DF2\u9009\u62E9" : "\u9009\u62E9\u540E\u52A0\u5165\u5F53\u524D\u8349\u7A3F"}</small></button>`).join("")}<details><summary>\u6DFB\u52A0\u793A\u4F8B\u8FDE\u63A5</summary><form id="px-model-form" class="px-stack" style="margin-top:16px"><label>\u8FDE\u63A5\u540D\u79F0<input id="px-new-model" required maxlength="60" placeholder="\u4F8B\u5982\uFF1A\u6211\u7684\u5907\u7528\u6A21\u578B"></label><p class="px-muted">\u6F14\u793A\u4E0D\u9700\u8981 API Key\uFF0C\u4E0D\u4F1A\u8FDB\u884C\u7F51\u7EDC\u8BF7\u6C42\u3002</p><button class="px-primary" type="button" data-action="add-model">\u6DFB\u52A0\u5E76\u9009\u62E9</button></form></details>`);
    }
    function renderBots() {
      if (!wizard) return `<div class="px-section-heading"><h2>\u5DF2\u63A5\u5165\u7684\u673A\u5668\u4EBA</h2><button class="px-primary px-push-right" type="button" data-action="new-bot">${icon("plus")}\u63A5\u5165\u673A\u5668\u4EBA</button></div><p class="px-muted">\u793A\u4F8B\u8FDE\u63A5\u3002\u70B9\u51FB\u63A5\u5165\uFF0C\u53EF\u4EE5\u5B8C\u6574\u8D70\u4E00\u904D\u914D\u7F6E\u6D41\u7A0B\u3002</p>${robots.map((robot, index) => `<div class="px-list-row"><div><strong>${escape(robot.name)}</strong><small>${robot.platform} \xB7 \u666E\u745E\u8D5B\u65AF \xB7 ${escape(robot.scope)}</small><small>${escape(robot.trigger)} \xB7 ${robot.state}</small></div><span class="px-tag">${robot.enabled ? "\u6A21\u62DF\u5DF2\u8FDE\u63A5" : "\u6A21\u62DF\u5DF2\u505C\u7528"}</span><button type="button" data-robot="${index}">${robot.enabled ? "\u505C\u7528" : "\u542F\u7528"}</button><button type="button" data-bot-detail="${index}">\u5904\u7406\u89C4\u5219</button></div>`).join("")}<div class="px-form-section"><h3>\u4E00\u5957\u5168\u5C40\u6D88\u606F\u8DEF\u7531</h3><p class="px-muted">\u5E73\u53F0\u6D88\u606F \u2192 \u89E6\u53D1\u68C0\u67E5 \u2192 \u6743\u9650\u68C0\u67E5 \u2192 Agent \u2192 \u56DE\u590D\u6295\u9012</p><button type="button" data-action="route" style="margin-top:15px">\u6A21\u62DF\u4E00\u6761\u7FA4\u6D88\u606F</button></div>`;
      const w = wizard;
      let content = "";
      if (w.step === 1) content = `<h2>\u9009\u62E9\u63A5\u5165\u5E73\u53F0</h2><p class="px-muted" style="margin-top:10px">\u4E09\u79CD\u5E73\u53F0\u6CBF\u7528\u540C\u4E00\u5957\u201C\u8FDE\u63A5 \u2192 \u5904\u7406\u89C4\u5219 \u2192 \u786E\u8BA4\u201D\u6D41\u7A0B\u3002</p><div class="px-choice-grid">${["NapCat", "Telegram", "\u5FAE\u4FE1"].map((platform) => `<button type="button" data-platform="${platform}" aria-pressed="${platform === w.platform}"><strong>${platform}</strong><small>${platform === "NapCat" ? "QQ / OneBot" : platform === "Telegram" ? "Bot API" : "\u5FAE\u4FE1\u673A\u5668\u4EBA"}</small></button>`).join("")}</div><label>\u673A\u5668\u4EBA\u540D\u79F0<input name="robotName" value="${escape(w.name)}" maxlength="60" placeholder="\u4F8B\u5982\uFF1A\u6211\u7684 QQ \u52A9\u624B"></label>`;
      else if (w.step === 2) content = `<h2>\u8FDE\u63A5 ${w.platform}</h2><p class="px-muted" style="margin:10px 0 24px">\u6B64\u6B65\u9AA4\u6A21\u62DF\u8FDE\u901A\u6027\u68C0\u67E5\uFF0C\u4E0D\u4FDD\u5B58\u51ED\u636E\u3001\u4E0D\u8BBF\u95EE\u670D\u52A1\u3002</p><label>${w.platform === "NapCat" ? "WebSocket \u5730\u5740" : w.platform === "Telegram" ? "Token \u5F15\u7528\u540D\u79F0\uFF08\u793A\u4F8B\uFF09" : "\u767B\u5F55\u8FDE\u63A5\u540D\u79F0\uFF08\u793A\u4F8B\uFF09"}<input name="robotAddress" value="${escape(w.address)}" placeholder="${w.platform === "NapCat" ? "ws://127.0.0.1:3001" : "demo-connection"}"></label><div class="px-actions" style="margin-top:20px"><button type="button" data-action="check-bot" ${connectionTestBusy ? "disabled" : ""}>${connectionTestBusy ? "\u6B63\u5728\u6A21\u62DF\u68C0\u67E5\u2026" : "\u6A21\u62DF\u68C0\u67E5\u8FDE\u63A5"}</button><span role="status" class="px-muted">${w.checked ? "\u6A21\u62DF\u68C0\u67E5\u901A\u8FC7\uFF0C\u53EF\u4EE5\u7EE7\u7EED" : "\u5B8C\u6210\u68C0\u67E5\u540E\u7EE7\u7EED"}</span></div>`;
      else if (w.step === 3) content = `<h2>\u51B3\u5B9A\u5982\u4F55\u5904\u7406\u6D88\u606F</h2><div class="px-stack" style="margin-top:24px"><div class="px-list-row"><div>\u76EE\u6807 Agent<small>\u672C\u6B21\u6F14\u793A\u4F7F\u7528\u5F53\u524D Agent\u3002</small></div><strong>\u666E\u745E\u8D5B\u65AF</strong></div><label>\u7FA4\u804A\u89E6\u53D1\u65B9\u5F0F<select name="robotTrigger">${["\u63D0\u53CA\u6216\u56DE\u590D\u673A\u5668\u4EBA", "\u6240\u6709\u7FA4\u6D88\u606F", "\u4EC5\u79C1\u804A"].map((value) => option(value, w.trigger)).join("")}</select></label><label>\u5141\u8BB8\u7684\u4F1A\u8BDD\u8303\u56F4<input name="robotScope" value="${escape(w.scope)}" maxlength="120" placeholder="\u4F8B\u5982\uFF1A\u6D4B\u8BD5\u7FA4 10001"></label><label>\u9ED8\u8BA4\u8FD0\u884C\u6001<select name="robotState">${Object.entries(stateLabels).map(([value, label]) => option(value, w.state, label)).join("")}</select></label></div>`;
      else content = `<h2>\u786E\u8BA4\u63A5\u5165</h2><div class="px-list-row"><div>\u673A\u5668\u4EBA</div><strong>${escape(w.name)} \xB7 ${w.platform}</strong></div><div class="px-list-row"><div>Agent</div><strong>\u666E\u745E\u8D5B\u65AF</strong></div><div class="px-list-row"><div>\u89E6\u53D1\u65B9\u5F0F</div><span>${escape(w.trigger)}</span></div><div class="px-list-row"><div>\u4F1A\u8BDD\u8303\u56F4</div><span>${escape(w.scope)}</span></div><div class="px-list-row"><div>\u8FD0\u884C\u6001</div><span>${stateLabels[w.state]}</span></div><p class="px-hint">\u5B8C\u6210\u540E\u52A0\u5165\u539F\u578B\u7684\u673A\u5668\u4EBA\u5217\u8868\uFF1B\u771F\u5B9E QQ\u3001Telegram\u3001\u5FAE\u4FE1\u914D\u7F6E\u5747\u4E0D\u53D7\u5F71\u54CD\u3002</p>`;
      return `<div class="px-wizard"><ol class="px-step-list">${["\u9009\u62E9\u5E73\u53F0", "\u68C0\u67E5\u8FDE\u63A5", "\u5904\u7406\u89C4\u5219", "\u786E\u8BA4\u63A5\u5165"].map((label, index) => `<li ${w.step === index + 1 ? 'aria-current="step"' : ""}>${index + 1} \xB7 ${label}</li>`).join("")}</ol>${content}<div class="px-wizard-footer"><button type="button" data-action="${w.step === 1 ? "cancel-wizard" : "wizard-back"}">${w.step === 1 ? "\u53D6\u6D88" : "\u4E0A\u4E00\u6B65"}</button><button class="px-primary" type="button" data-action="wizard-next" ${w.step === 2 && !w.checked ? "disabled" : ""}>${w.step === 4 ? "\u5B8C\u6210\u63A5\u5165\uFF08\u6A21\u62DF\uFF09" : "\u4E0B\u4E00\u6B65"}</button></div></div>`;
    }
    function renderOther() {
      const target = get("#px-other-page");
      if (page === "bots") target.innerHTML = renderBots();
      else if (page === "resources") target.innerHTML = `<h2>\u53EF\u590D\u7528\u7684\u8D44\u6E90</h2><p class="px-muted" style="margin-top:10px">\u8D44\u6E90\u5728\u8FD9\u91CC\u96C6\u4E2D\u7BA1\u7406\uFF0C\u5728 Agent \u5185\u76F4\u63A5\u9009\u62E9\u3002</p><div class="px-list-row"><div><strong>\u4EBA\u683C\u5E93</strong><small>\u666E\u745E\u8D5B\u65AF\u3001\u7814\u7A76\u52A9\u624B\u3001\u65E5\u5E38\u4F19\u4F34 \xB7 3 \u4E2A\u793A\u4F8B</small></div><button type="button" data-action="personas">\u9009\u62E9\u4EBA\u683C</button></div><div class="px-list-row"><div><strong>\u77E5\u8BC6\u5E93</strong><small>\u9879\u76EE\u8D44\u6599\u5E93 \xB7 \u6587\u6863\u4E0E\u68C0\u7D22\u7ED3\u679C\u793A\u4F8B</small></div><button type="button" data-action="knowledge">\u67E5\u770B\u8D44\u6599</button></div><div class="px-list-row"><div><strong>\u957F\u671F\u8BB0\u5FC6</strong><small>\u6309\u4F1A\u8BDD\u548C\u53D1\u9001\u8005\u9694\u79BB</small></div><button type="button" data-action="memory">\u67E5\u770B\u8BB0\u5FC6</button></div><div class="px-list-row"><div><strong>\u5DE5\u5177\u4E0E\u63D2\u4EF6</strong><small>\u7F51\u7EDC\u641C\u7D22\u3001\u7FA4\u6587\u4EF6\u3001\u547D\u4EE4\u6267\u884C\uFF1BMCP \u4E0E Skills \u7EDF\u4E00\u9009\u62E9</small></div><button type="button" data-action="agent-tools">\u4E3A Agent \u88C5\u914D</button></div>`;
      else if (page === "settings") target.innerHTML = `<h2>\u670D\u52A1\u4E0E\u7CFB\u7EDF</h2><p class="px-muted" style="margin-top:10px">\u914D\u7F6E\u5E95\u5C42\u8FDE\u63A5\u3002\u5E38\u7528\u9009\u62E9\u4E5F\u53EF\u4EE5\u5728 Agent \u7F16\u8F91\u8FC7\u7A0B\u4E2D\u76F4\u63A5\u5B8C\u6210\u3002</p><div class="px-list-row"><div><strong>\u6A21\u578B\u8FDE\u63A5</strong><small>${models.length} \u4E2A\u793A\u4F8B\u8FDE\u63A5</small></div><button type="button" data-action="models">\u7BA1\u7406\u8FDE\u63A5</button></div><div class="px-list-row"><div><strong>\u51ED\u636E</strong><small>\u539F\u578B\u4E0D\u8BFB\u53D6\u3001\u4E0D\u4FDD\u5B58\u771F\u5B9E Token \u6216 API Key</small></div><button type="button" data-action="credentials">\u67E5\u770B\u4F7F\u7528\u65B9\u5F0F</button></div><div class="px-list-row"><div><strong>\u6267\u884C\u73AF\u5883</strong><small>Docker Sandbox \xB7 \u793A\u4F8B\u73AF\u5883</small></div><button type="button" data-action="environment">\u67E5\u770B\u73AF\u5883</button></div><div class="px-list-row"><div><strong>\u914D\u7F6E\u7248\u672C</strong><small>\u5F53\u524D\u6A21\u62DF\u7248\u672C v${revision}</small></div><button type="button" data-action="version">\u67E5\u770B\u5DF2\u53D1\u5E03\u914D\u7F6E</button></div>`;
      else target.innerHTML = `<div class="px-section-heading"><h2>\u4F1A\u8BDD\u4E0E\u4EFB\u52A1</h2><button type="button" class="px-primary px-push-right" data-action="test-agent">\u6D4B\u8BD5 Agent</button></div><p class="px-muted">\u793A\u4F8B\u4F1A\u8BDD\u3002\u76F4\u63A5\u4ECE\u6D88\u606F\u5B9A\u4F4D\u5BF9\u5E94\u4EFB\u52A1\u3001\u5DE5\u5177\u548C\u4EA7\u7269\u3002</p><div class="px-list-row"><div><strong>\u641C\u4E00\u4E0B\u8FD9\u4E2A\u578B\u53F7\u7684\u663E\u793A\u5668</strong><small>QQ \u7FA4\u804A \xB7 \u666E\u745E\u8D5B\u65AF \xB7 \u793A\u4F8B\u6D88\u606F</small></div><span class="px-tag">\u793A\u4F8B\u5DF2\u5B8C\u6210</span><button type="button" data-action="sample-success">\u67E5\u770B\u8FC7\u7A0B</button></div><div class="px-list-row"><div><strong>\u4E0B\u8F7D\u6E05\u5355\u4E2D\u7684\u6587\u4EF6</strong><small>QQ \u7FA4\u804A \xB7 \u666E\u745E\u8D5B\u65AF \xB7 \u793A\u4F8B\u6D88\u606F</small></div><span class="px-danger">\u793A\u4F8B\u5931\u8D25</span><button type="button" data-action="sample-failure">\u67E5\u770B\u539F\u56E0</button></div><div class="px-form-section"><h3>\u4ECE\u8FD9\u91CC\u5F00\u59CB\u4F53\u9A8C</h3><div class="px-list-row"><div>\u6539\u4EBA\u683C\u5E76\u6D4B\u8BD5<small>\u4E0D\u79BB\u5F00 Agent \u9875\u9762\u5C31\u80FD\u770B\u5230\u6548\u679C\u3002</small></div><button type="button" data-action="test-agent">\u8FDB\u5165 Agent</button></div><div class="px-list-row"><div>\u63A5\u5165 NapCat<small>\u6309\u56DB\u4E2A\u6B65\u9AA4\u5B8C\u6210\u6A21\u62DF\u914D\u7F6E\u3002</small></div><button type="button" data-action="new-bot">\u5F00\u59CB\u63A5\u5165</button></div></div>`;
      icons();
    }
    function navigate(next) {
      page = next;
      const names = { agent: "\u666E\u745E\u8D5B\u65AF", workbench: "\u5DE5\u4F5C\u53F0", bots: "\u673A\u5668\u4EBA", resources: "\u8D44\u6E90\u5E93", settings: "\u8BBE\u7F6E" };
      get("#px-title").textContent = names[page];
      get("#px-breadcrumb").textContent = page === "agent" ? "Agent / \u666E\u745E\u8D5B\u65AF" : `\u666E\u745E\u8D5B\u65AF / ${names[page]}`;
      get("#px-subtitle").textContent = page === "agent" ? "\u65E5\u5E38\u52A9\u624B" : "";
      get("#px-agent-page").hidden = page !== "agent";
      get("#px-other-page").hidden = page === "agent";
      get("#px-header-actions").hidden = page !== "agent";
      for (const button of app.querySelectorAll(".px-sidebar [data-page]")) {
        if (button.dataset["page"] === page) button.setAttribute("aria-current", "page");
        else button.removeAttribute("aria-current");
      }
      get("#px-notice").hidden = true;
      if (page === "agent") {
        renderEditor();
        renderChat();
      } else renderOther();
    }
    function chooseTab(next) {
      tab = next;
      if (page !== "agent") navigate("agent");
      else renderEditor();
    }
    function newBot() {
      wizard = { step: 1, platform: "NapCat", name: "\u6211\u7684 QQ \u52A9\u624B", address: "ws://127.0.0.1:3001", checked: false, trigger: "\u63D0\u53CA\u6216\u56DE\u590D\u673A\u5668\u4EBA", scope: "\u6D4B\u8BD5\u7FA4 10001", state: "normal" };
      navigate("bots");
    }
    function publishDialog() {
      if (!draft.persona.trim()) {
        notice("\u89D2\u8272\u8BBE\u5B9A\u4E0D\u80FD\u4E3A\u7A7A\uFF0C\u8BF7\u8865\u5145\u540E\u518D\u53D1\u5E03\u3002", true);
        chooseTab("persona");
        return;
      }
      if (!Number.isInteger(draft.turns) || draft.turns < 1 || draft.turns > 100) {
        notice("\u4FDD\u7559\u5BF9\u8BDD\u8F6E\u6570\u5E94\u4E3A 1 \u5230 100 \u7684\u6574\u6570\u3002", true);
        chooseTab("context");
        return;
      }
      openDialog("\u53D1\u5E03\u5F53\u524D Agent", `<p>\u8FD9\u6B21\u4FEE\u6539\u53EA\u5C5E\u4E8E <strong>\u666E\u745E\u8D5B\u65AF</strong>\uFF1A</p><ul class="px-change-list">${fieldsChanged().map((change) => `<li>${escape(change)}</li>`).join("")}</ul><p class="px-hint">\u8FD9\u662F\u539F\u578B\u4E2D\u7684\u6A21\u62DF\u53D1\u5E03\uFF0C\u4E0D\u4F1A\u4FDD\u5B58\u5230 NAS \u6216\u91CD\u542F\u673A\u5668\u4EBA\u3002</p><div class="px-dialog-footer"><button type="button" data-action="close-dialog">\u7EE7\u7EED\u7F16\u8F91</button><button class="px-primary" type="button" data-action="confirm-publish">\u786E\u8BA4\u53D1\u5E03\uFF08\u6A21\u62DF\uFF09</button></div>`);
    }
    async function checkBot() {
      const w = wizard;
      if (!w || connectionTestBusy) return;
      if (!w.address.trim() || w.platform === "NapCat" && !(w.address.startsWith("ws://") || w.address.startsWith("wss://"))) {
        notice(w.platform === "NapCat" ? "\u8BF7\u586B\u5199 ws:// \u6216 wss:// \u5F00\u5934\u7684 WebSocket \u5730\u5740\u3002" : "\u8BF7\u586B\u5199\u793A\u4F8B\u8FDE\u63A5\u540D\u79F0\u3002", true);
        return;
      }
      const generation = ++connectionTestGeneration;
      const address = w.address;
      connectionTestBusy = true;
      renderOther();
      await new Promise((resolve) => setTimeout(resolve, 650));
      if (generation !== connectionTestGeneration) return;
      connectionTestBusy = false;
      if (wizard === w) {
        if (w.address === address) {
          w.checked = true;
          if (page === "bots") notice("\u6A21\u62DF\u68C0\u67E5\u901A\u8FC7\u3002\u6CA1\u6709\u53D1\u8D77\u4EFB\u4F55\u5B9E\u9645\u7F51\u7EDC\u8FDE\u63A5\u3002");
        }
        if (page === "bots") renderOther();
      }
    }
    function wizardNext() {
      const w = wizard;
      if (!w) return;
      if (!w.name.trim()) {
        notice("\u8BF7\u5148\u586B\u5199\u673A\u5668\u4EBA\u540D\u79F0\u3002", true);
        return;
      }
      if (w.step === 2 && !w.checked) return;
      if (w.step === 3 && !w.scope.trim()) {
        notice("\u8BF7\u6307\u5B9A\u5141\u8BB8\u7684\u4F1A\u8BDD\u8303\u56F4\u3002", true);
        return;
      }
      if (w.step === 4) {
        robots.push({ name: w.name.trim(), platform: w.platform, trigger: w.trigger, scope: w.scope, state: stateLabels[w.state], enabled: true });
        wizard = null;
        renderOther();
        notice("\u6A21\u62DF\u63A5\u5165\u5B8C\u6210\u3002\u65B0\u673A\u5668\u4EBA\u5DF2\u52A0\u5165\u4E0B\u65B9\u5217\u8868\u3002");
      } else {
        w.step++;
        get("#px-notice").hidden = true;
        renderOther();
      }
    }
    app.addEventListener("input", (event) => {
      const field = event.target;
      if (!(field instanceof HTMLInputElement || field instanceof HTMLTextAreaElement || field instanceof HTMLSelectElement)) return;
      const value = field.value;
      const checked = field instanceof HTMLInputElement && field.checked;
      switch (field.name) {
        case "persona":
          draft.persona = value;
          break;
        case "extra":
          draft.extra = value;
          break;
        case "model":
          draft.model = value;
          break;
        case "example-user": {
          const entry = draft.examples[Number(field.dataset["index"])];
          if (entry) entry.user = value;
          break;
        }
        case "example-assistant": {
          const entry = draft.examples[Number(field.dataset["index"])];
          if (entry) entry.assistant = value;
          break;
        }
        case "search":
          draft.search = checked;
          break;
        case "files":
          draft.files = checked;
          break;
        case "command":
          draft.command = checked;
          break;
        case "knowledge":
          draft.knowledge = checked;
          break;
        case "memory":
          draft.memory = checked;
          break;
        case "compress":
          draft.compress = checked;
          break;
        case "turns":
          draft.turns = Number(value);
          break;
        case "approval":
          draft.approval = checked;
          break;
        case "state":
          if (value === "normal" || value === "senior" || value === "elite") draft.state = value;
          break;
        case "robotName":
          if (wizard) wizard.name = value;
          break;
        case "robotAddress":
          if (wizard) {
            wizard.address = value;
            wizard.checked = false;
            const button = app.querySelector('[data-action="wizard-next"]');
            if (button) button.disabled = true;
          }
          break;
        case "robotTrigger":
          if (wizard) wizard.trigger = value;
          break;
        case "robotScope":
          if (wizard) wizard.scope = value;
          break;
        case "robotState":
          if (wizard && (value === "normal" || value === "senior" || value === "elite")) wizard.state = value;
          break;
      }
      syncDraftStatus();
    });
    app.addEventListener("change", (event) => {
      const field = event.target;
      if (field instanceof HTMLInputElement && field.id === "px-file") {
        attachment = field.files?.[0]?.name ?? "";
        get("#px-attachment").textContent = attachment ? `\u5DF2\u9009\u62E9\uFF1A${attachment}\uFF08\u53EA\u6A21\u62DF\uFF0C\u4E0D\u4E0A\u4F20\uFF09` : "";
      }
      if (field instanceof HTMLSelectElement && field.name === "state") renderEditor();
      if (field instanceof HTMLInputElement && ["command", "memory", "compress"].includes(field.name)) renderEditor();
    });
    app.addEventListener("click", (event) => {
      const target = event.target;
      if (!(target instanceof Element)) return;
      const button = target.closest("button");
      if (!(button instanceof HTMLButtonElement) || !app.contains(button) || button.disabled) return;
      const nextPage = button.dataset["page"];
      if (nextPage === "agent" || nextPage === "bots" || nextPage === "resources" || nextPage === "settings" || nextPage === "workbench") {
        navigate(nextPage);
        return;
      }
      const nextTab = button.dataset["tab"];
      if (nextTab === "persona" || nextTab === "tools" || nextTab === "context" || nextTab === "permissions") {
        chooseTab(nextTab);
        return;
      }
      const persona = button.dataset["persona"];
      if (persona) {
        if (persona === "priestess") {
          draft.persona = initial.persona;
          draft.personaName = "\u666E\u745E\u8D5B\u65AF";
        } else if (persona === "research") {
          draft.persona = "\u4F60\u662F\u4E00\u4F4D\u4E25\u8C28\u7684\u7814\u7A76\u52A9\u624B\u3002\n\u5148\u6838\u5BF9\u8BC1\u636E\uFF0C\u518D\u7ED9\u51FA\u7ED3\u8BBA\u3002\n\u6E05\u695A\u6807\u6CE8\u6765\u6E90\u548C\u4E0D\u786E\u5B9A\u6027\uFF0C\u4E0D\u7F16\u9020\u5DE5\u5177\u7ED3\u679C\u3002";
          draft.personaName = "\u7814\u7A76\u52A9\u624B";
        } else {
          draft.persona = "\u4F60\u662F\u4E00\u4F4D\u81EA\u7136\u3001\u53EF\u9760\u7684\u65E5\u5E38\u4F19\u4F34\u3002\n\u5148\u7406\u89E3\u9700\u6C42\uFF0C\u518D\u5E2E\u52A9\u5B8C\u6210\u3002\n\u56DE\u7B54\u7B80\u6D01\uFF0C\u8868\u8FBE\u6E29\u548C\uFF0C\u9047\u5230\u590D\u6742\u95EE\u9898\u9010\u6B65\u89E3\u91CA\u3002";
          draft.personaName = "\u65E5\u5E38\u4F19\u4F34";
        }
        closeDialog();
        chooseTab("persona");
        notice("\u4EBA\u683C\u5DF2\u590D\u5236\u5230\u5F53\u524D Agent \u8349\u7A3F\uFF0C\u53EF\u4EE5\u7EE7\u7EED\u4FEE\u6539\u6216\u76F4\u63A5\u6D4B\u8BD5\u3002");
        return;
      }
      const modelIndex = button.dataset["model"];
      if (modelIndex !== void 0) {
        const model = models[Number(modelIndex)];
        if (model) draft.model = model;
        closeDialog();
        if (page === "agent") renderEditor();
        syncDraftStatus();
        notice("\u6A21\u578B\u9009\u62E9\u5DF2\u52A0\u5165 Agent \u8349\u7A3F\u3002");
        return;
      }
      const platform = button.dataset["platform"];
      if (wizard && (platform === "NapCat" || platform === "Telegram" || platform === "\u5FAE\u4FE1")) {
        wizard.platform = platform;
        wizard.name = platform === "NapCat" ? "\u6211\u7684 QQ \u52A9\u624B" : `\u6211\u7684 ${platform} \u52A9\u624B`;
        wizard.address = platform === "NapCat" ? "ws://127.0.0.1:3001" : "demo-connection";
        wizard.checked = false;
        renderOther();
        return;
      }
      const robotIndex = button.dataset["robot"];
      if (robotIndex !== void 0) {
        const robot = robots[Number(robotIndex)];
        if (robot) {
          robot.enabled = !robot.enabled;
          renderOther();
          notice(`${robot.name} \u5DF2${robot.enabled ? "\u542F\u7528" : "\u505C\u7528"}\uFF08\u6A21\u62DF\uFF09\u3002`);
        }
        return;
      }
      const botDetail = button.dataset["botDetail"];
      if (botDetail !== void 0) {
        const robot = robots[Number(botDetail)];
        if (robot) openDialog(`${robot.name} \xB7 \u5904\u7406\u89C4\u5219`, `<div class="px-stack"><p>\u89E6\u53D1\uFF1A${escape(robot.trigger)}</p><p>\u8303\u56F4\uFF1A${escape(robot.scope)}</p><p>Agent\uFF1A\u666E\u745E\u8D5B\u65AF</p><p>\u8FD0\u884C\u6001\uFF1A${robot.state}</p><p class="px-muted">\u8FD9\u91CC\u5C55\u793A\u5F53\u524D\u673A\u5668\u4EBA\u7684\u89C4\u5219\u89C6\u56FE\uFF0C\u5E95\u5C42\u4ECD\u7136\u53EA\u6709\u4E00\u5957\u5168\u5C40\u6D88\u606F\u8DEF\u7531\u3002</p><button type="button" data-action="route">\u6A21\u62DF\u6D88\u606F\u8DEF\u7531</button></div>`);
        return;
      }
      switch (button.dataset["action"]) {
        case "send":
          sendTest();
          break;
        case "add-model":
          addModel();
          break;
        case "close-dialog":
          closeDialog();
          break;
        case "personas":
          personasDialog();
          break;
        case "models":
          modelDialog();
          break;
        case "add-example":
          if (draft.examples.length >= 5) {
            notice("\u6B64\u539F\u578B\u6700\u591A\u5C55\u793A 5 \u7EC4\u793A\u4F8B\u3002");
            break;
          }
          draft.examples.push({ user: "", assistant: "" });
          renderEditor();
          break;
        case "remove-example":
          draft.examples.splice(Number(button.dataset["index"]), 1);
          renderEditor();
          break;
        case "publish":
          publishDialog();
          break;
        case "confirm-publish":
          published = structuredClone(draft);
          revision++;
          closeDialog();
          syncDraftStatus();
          notice(`\u6A21\u62DF\u53D1\u5E03\u6210\u529F \xB7 v${revision}\u3002\u771F\u5B9E\u673A\u5668\u4EBA\u914D\u7F6E\u6CA1\u6709\u53D8\u5316\u3002`);
          break;
        case "discard":
          openDialog("\u653E\u5F03\u672A\u53D1\u5E03\u4FEE\u6539\uFF1F", '<p>\u5F53\u524D Agent \u6062\u590D\u4E3A\u6700\u8FD1\u4E00\u6B21\u6A21\u62DF\u53D1\u5E03\u7684\u5185\u5BB9\u3002\u6D4B\u8BD5\u5BF9\u8BDD\u4F1A\u4FDD\u7559\u3002</p><div class="px-dialog-footer"><button type="button" data-action="close-dialog">\u7EE7\u7EED\u7F16\u8F91</button><button type="button" class="px-danger" data-action="confirm-discard">\u653E\u5F03\u4FEE\u6539</button></div>');
          break;
        case "confirm-discard":
          draft = structuredClone(published);
          closeDialog();
          renderEditor();
          notice("\u5DF2\u6062\u590D\u5230\u6700\u8FD1\u4E00\u6B21\u6A21\u62DF\u53D1\u5E03\u7684\u914D\u7F6E\u3002");
          break;
        case "clear-chat":
          chatGeneration++;
          chatBusy = false;
          messages = [];
          renderChat();
          break;
        case "new-bot":
          newBot();
          break;
        case "check-bot":
          void checkBot();
          break;
        case "wizard-next":
          wizardNext();
          break;
        case "wizard-back":
          if (wizard) {
            wizard.step = Math.max(1, wizard.step - 1);
            renderOther();
          }
          break;
        case "cancel-wizard":
          wizard = null;
          connectionTestGeneration++;
          connectionTestBusy = false;
          renderOther();
          break;
        case "test-agent":
          chooseTab("persona");
          get("#px-message").focus();
          break;
        case "agent-tools":
          closeDialog();
          chooseTab("tools");
          break;
        case "knowledge":
          openDialog("\u9879\u76EE\u8D44\u6599\u5E93", '<div class="px-list-row"><div><strong>\u9879\u76EE\u8BF4\u660E.md</strong><small>\u793A\u4F8B\u6587\u6863 \xB7 \u5DF2\u7D22\u5F15</small></div></div><div class="px-list-row"><div><strong>\u4EA7\u54C1\u53C2\u6570.pdf</strong><small>\u793A\u4F8B\u6587\u6863 \xB7 \u5DF2\u7D22\u5F15</small></div></div><p class="px-hint">\u5728 Agent \u7684\u201C\u80FD\u529B\u4E0E\u8D44\u6599\u201D\u4E2D\u52FE\u9009\u9879\u76EE\u8D44\u6599\u5E93\uFF0C\u5373\u53EF\u6A21\u62DF\u7ED1\u5B9A\u3002</p><button type="button" data-action="agent-tools">\u53BB\u7ED1\u5B9A\u77E5\u8BC6\u5E93</button>');
          break;
        case "memory":
          openDialog("\u957F\u671F\u8BB0\u5FC6 \xB7 \u793A\u4F8B", '<div class="px-list-row"><div><strong>\u56DE\u590D\u65F6\u5148\u7ED9\u7ED3\u8BBA\uFF0C\u518D\u5C55\u5F00\u8BF4\u660E\u3002</strong><small>\u8303\u56F4\uFF1A\u5F53\u524D\u53D1\u9001\u8005 \xB7 \u6765\u6E90\uFF1A\u793A\u4F8B\u5BF9\u8BDD</small></div></div><div class="px-list-row"><div><strong>\u6D4B\u8BD5\u7FA4\u5173\u6CE8\u663E\u793A\u5668\u53C2\u6570\u4E0E\u4EF7\u683C\u3002</strong><small>\u8303\u56F4\uFF1A\u6D4B\u8BD5\u7FA4 10001 \xB7 \u4E0D\u5171\u4EAB\u7ED9\u5176\u4ED6\u4F1A\u8BDD</small></div></div><p class="px-muted">\u8FD9\u91CC\u5C55\u793A\u8BB0\u5FC6\u7684\u5185\u5BB9\u3001\u6765\u6E90\u548C\u4F5C\u7528\u57DF\u3002</p>');
          break;
        case "route":
          openDialog("\u6A21\u62DF\u7FA4\u6D88\u606F\u8DEF\u7531", '<p>\u6D4B\u8BD5\u7FA4 10001\uFF1A@\u673A\u5668\u4EBA \u5E2E\u6211\u641C\u7D22\u8FD9\u6B3E\u663E\u793A\u5668</p><ol class="px-change-list"><li>\u6D88\u606F\u63A5\u5165\uFF1ANapCat \u7FA4\u804A</li><li>\u89E6\u53D1\u68C0\u67E5\uFF1A\u5DF2\u63D0\u53CA\u673A\u5668\u4EBA</li><li>\u6743\u9650\u68C0\u67E5\uFF1A\u666E\u901A\u5E72\u5458\uFF0C\u53EF\u641C\u7D22</li><li>\u76EE\u6807 Agent\uFF1A\u666E\u745E\u8D5B\u65AF</li><li>\u751F\u6210\u56DE\u590D \u2192 \u7FA4\u804A\u6295\u9012\uFF08\u4EC5\u793A\u610F\uFF09</li></ol><p class="px-muted">\u56FA\u5B9A\u6D41\u7A0B\uFF0C\u5404\u8282\u70B9\u53EF\u5206\u522B\u7F16\u8F91\uFF1B\u672C\u539F\u578B\u6CA1\u6709\u53D1\u9001\u4EFB\u4F55\u6D88\u606F\u3002</p>');
          break;
        case "sample-success":
          openDialog("\u663E\u793A\u5668\u67E5\u8BE2 \xB7 \u793A\u4F8B\u6267\u884C", '<ol class="px-change-list"><li>\u7FA4\u6D88\u606F\u53CA\u5F15\u7528\u56FE\u7247\u8FDB\u5165\u4F1A\u8BDD</li><li>\u8BC6\u522B\u578B\u53F7\u4E0E\u4EA7\u54C1\u4FE1\u606F</li><li>\u68C0\u7D22\u4E0E\u4EA4\u53C9\u6838\u5BF9\u53C2\u6570</li><li>\u8FD4\u56DE\u7ED3\u679C\u5E76\u9644\u4E0A\u6765\u6E90</li></ol><p class="px-muted">\u8FD9\u662F\u4EA4\u4E92\u6F14\u793A\u6570\u636E\uFF0C\u4E0D\u662F NAS \u4E0A\u7684\u771F\u5B9E\u4EFB\u52A1\u8BB0\u5F55\u3002</p><div class="px-dialog-footer"><button type="button" data-action="agent-tools">\u67E5\u770B Agent \u80FD\u529B</button></div>');
          break;
        case "sample-failure":
          openDialog("\u4E0B\u8F7D\u5931\u8D25 \xB7 \u793A\u4F8B\u8BCA\u65AD", '<p><strong>\u5931\u8D25\u8282\u70B9\uFF1A\u6743\u9650\u68C0\u67E5</strong></p><p class="px-hint">\u5DE5\u5177\u5DF2\u7ECF\u88C5\u914D\uFF0C\u4F46\u53D1\u9001\u8005\u53EA\u6709\u666E\u901A\u5E72\u5458\u6743\u9650\uFF0C\u672A\u83B7\u5F97\u547D\u4EE4\u6267\u884C\u80FD\u529B\u3002</p><p class="px-muted">\u6B64\u5904\u7528\u4E8E\u6F14\u793A\u5931\u8D25\u5B9A\u4F4D\uFF0C\u4E0D\u4EE3\u8868\u4F60\u4E4B\u524D\u90A3\u6B21\u4E0B\u8F7D\u4EFB\u52A1\u7684\u771F\u5B9E\u539F\u56E0\u3002</p><div class="px-dialog-footer"><button type="button" data-action="fix-permission">\u67E5\u770B\u6743\u9650\u914D\u7F6E</button></div>');
          break;
        case "fix-permission":
          closeDialog();
          chooseTab("permissions");
          break;
        case "credentials":
          openDialog("\u51ED\u636E\u4F7F\u7528\u65B9\u5F0F", '<p>\u6B63\u5F0F\u4EA7\u54C1\u5728\u8FD9\u91CC\u7BA1\u7406\u51ED\u636E\uFF0C\u5728\u6A21\u578B\u3001\u673A\u5668\u4EBA\u3001\u641C\u7D22\u914D\u7F6E\u4E2D\u5F15\u7528\u3002</p><p class="px-hint">\u4EA4\u4E92\u539F\u578B\u4E0D\u9700\u8981\u771F\u5B9E\u5BC6\u94A5\u3002\u8BF7\u4F7F\u7528\u793A\u4F8B\u8FDE\u63A5\u540D\u79F0\u4F53\u9A8C\u64CD\u4F5C\u3002</p>');
          break;
        case "environment":
          openDialog("\u6267\u884C\u73AF\u5883 \xB7 \u793A\u4F8B", '<div class="px-stack"><p>\u73AF\u5883\uFF1ADocker Sandbox</p><p>\u6587\u4EF6\u8303\u56F4\uFF1AAgent \u5DF2\u6388\u6743\u5DE5\u4F5C\u76EE\u5F55</p><p>\u6267\u884C\u6743\u9650\uFF1A\u9700\u8981\u5DE5\u5177\u88C5\u914D\u4E0E\u53D1\u9001\u8005\u6388\u6743</p><p class="px-muted">\u539F\u578B\u4E0D\u4F1A\u521B\u5EFA\u5BB9\u5668\u3001\u8BFB\u53D6\u76EE\u5F55\u6216\u8FD0\u884C\u547D\u4EE4\u3002</p><button type="button" data-action="agent-tools">\u67E5\u770B Agent \u5DE5\u5177</button></div>');
          break;
        case "version":
          openDialog(`\u5DF2\u53D1\u5E03\u914D\u7F6E \xB7 v${revision}`, `<div class="px-stack"><p>\u4EBA\u683C\uFF1A${escape(published.personaName)}</p><p>\u6A21\u578B\uFF1A${escape(published.model)}</p><p>\u793A\u4F8B\u5BF9\u8BDD\uFF1A${published.examples.length} \u7EC4</p><p>\u7F51\u7EDC\u641C\u7D22\uFF1A${published.search ? "\u542F\u7528" : "\u5173\u95ED"}</p><p>\u8FD0\u884C\u6001\uFF1A${stateLabels[published.state]}</p><p class="px-muted">\u8FD9\u662F\u672C\u6B21\u9875\u9762\u5185\u7684\u6A21\u62DF\u7248\u672C\uFF0C\u5237\u65B0\u540E\u91CD\u7F6E\u3002</p></div>`);
          break;
        case "reset":
          openDialog("\u91CD\u7F6E\u6F14\u793A\uFF1F", '<p>\u6E05\u9664\u8FD9\u6B21\u539F\u578B\u91CC\u7684\u8349\u7A3F\u3001\u6D4B\u8BD5\u6D88\u606F\u548C\u65B0\u589E\u673A\u5668\u4EBA\uFF0C\u6062\u590D\u521D\u59CB\u793A\u4F8B\u3002</p><div class="px-dialog-footer"><button type="button" data-action="close-dialog">\u4FDD\u7559\u5F53\u524D\u64CD\u4F5C</button><button type="button" class="px-danger" data-action="confirm-reset">\u91CD\u7F6E\u6F14\u793A</button></div>');
          break;
        case "confirm-reset":
          draft = structuredClone(initial);
          published = structuredClone(initial);
          revision = 1;
          models.splice(3);
          robots.splice(1);
          if (robots[0]) robots[0].enabled = true;
          wizard = null;
          chatGeneration++;
          connectionTestGeneration++;
          connectionTestBusy = false;
          chatBusy = false;
          messages = [];
          attachment = "";
          get("#px-attachment").textContent = "";
          {
            const message = get("#px-message");
            if (message instanceof HTMLTextAreaElement) message.value = "";
            const file = get("#px-file");
            if (file instanceof HTMLInputElement) file.value = "";
          }
          closeDialog();
          tab = "persona";
          navigate("agent");
          notice("\u6F14\u793A\u5DF2\u91CD\u7F6E\u3002");
          break;
      }
    });
    function addModel() {
      const form = get("#px-model-form");
      if (form instanceof HTMLFormElement && !form.reportValidity()) return;
      const name = inputValue("#px-new-model").trim();
      if (!name) return;
      if (!models.includes(name)) models.push(name);
      draft.model = name;
      closeDialog();
      if (page === "agent") renderEditor();
      else renderOther();
      syncDraftStatus();
      notice("\u793A\u4F8B\u6A21\u578B\u8FDE\u63A5\u5DF2\u6DFB\u52A0\uFF0C\u5E76\u9009\u5165 Agent \u8349\u7A3F\u3002");
      return;
    }
    function sendTest() {
      if (chatBusy) return;
      const text = inputValue("#px-message").trim();
      if (!text && !attachment) {
        get("#px-message").focus();
        return;
      }
      const file = attachment;
      const config = structuredClone(draft);
      const generation = ++chatGeneration;
      messages.push({ role: "user", content: `${text}${file ? `
\u9644\u4EF6\uFF1A${file}` : ""}` });
      const field = get("#px-message");
      if (field instanceof HTMLTextAreaElement) field.value = "";
      const fileField = get("#px-file");
      if (fileField instanceof HTMLInputElement) fileField.value = "";
      attachment = "";
      get("#px-attachment").textContent = "";
      chatBusy = true;
      renderChat();
      setTimeout(() => {
        if (generation !== chatGeneration) return;
        messages.push(simulateReply(text, config, file));
        chatBusy = false;
        renderChat();
      }, 600);
    }
    app.addEventListener("submit", (event) => {
      const form = event.target;
      if (!(form instanceof HTMLFormElement)) return;
      event.preventDefault();
      if (form.id === "px-model-form") addModel();
      else if (form.id === "px-chat-form") sendTest();
    });
    app.addEventListener("keydown", (event) => {
      const target = event.target;
      if (event.key === "Enter" && target instanceof HTMLTextAreaElement && target.id === "px-message" && (event.ctrlKey || event.metaKey)) {
        event.preventDefault();
        sendTest();
      }
      if (event.key === "Enter" && target instanceof HTMLInputElement && target.id === "px-new-model") {
        event.preventDefault();
        addModel();
      }
    });
    renderEditor();
    renderChat();
    icons();
  })();
})();
