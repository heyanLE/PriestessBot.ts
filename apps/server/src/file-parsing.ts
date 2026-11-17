import type { FileParsingSettings } from '../../../packages/contracts/src/file-parsing.js';
import { FileParsingConfigurationSchema, FileParsingSettingsSchema } from '../../../packages/contracts/src/file-parsing.js';
import type { RuntimeStore } from '../../../packages/core/src/storage.js';

export class FileParsingError extends Error {
  override readonly name = 'FileParsingError';
  constructor(readonly status: number, message: string) { super(message); }
}

/** Formats the in-process extractor handles today. */
export const LOCAL_FORMATS: readonly string[] = Object.freeze(['pdf', 'txt', 'md', 'markdown', 'csv', 'tsv', 'json', 'yaml', 'yml', 'log', 'docx', 'pptx', 'xlsx']);
/** Formats the provider accepts for document questions. */
export const REMOTE_FORMATS: readonly string[] = Object.freeze(['pdf', 'docx', 'doc', 'pptx', 'ppt', 'png', 'jpg', 'jpeg', 'webp', 'gif', 'bmp', 'tif', 'tiff', 'txt', 'md', 'csv', 'epub', 'mobi']);

/** Settings live beside search settings; a stale revision means someone else saved first. */
export class FileParsingSettingsService {
  constructor(private readonly store: RuntimeStore) {}
  settings(): FileParsingSettings { return this.store.get('file-parsing', 'settings', FileParsingSettingsSchema) ?? FileParsingSettingsSchema.parse({}); }
  update(input: unknown, expectedRevision: number): FileParsingSettings {
    const config = FileParsingConfigurationSchema.parse(input);
    const previous = this.settings();
    if (previous.revision !== expectedRevision) throw new FileParsingError(409, 'File parsing settings changed; reload before saving');
    const next = FileParsingSettingsSchema.parse({ ...config, revision: previous.revision + 1 });
    this.store.put('file-parsing', 'settings', next);
    return next;
  }
  status(remoteAvailable: boolean) {
    const settings = this.settings();
    return { settings, localFormats: [...LOCAL_FORMATS], remoteFormats: [...REMOTE_FORMATS], remoteAvailable };
  }
}

/** Remote parsing runs only when the switch says so, the provider allows it and the connection supports it. */
export function shouldUploadDocuments(settings: FileParsingSettings, connectionSupportsUpload: boolean): boolean {
  return settings.enabled && settings.provider === 'deepseek' && connectionSupportsUpload;
}
