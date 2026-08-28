import { resolve } from 'node:path';
import { buildReleaseArtifact } from './release-artifact.mjs';
const index = process.argv.indexOf('--output'); const output = index === -1 ? resolve('dist') : resolve(process.argv[index + 1]);
const result = buildReleaseArtifact({ sourceRoot: resolve('.'), outputDir: output });
console.log(JSON.stringify({ artifact: result.archive, checksum: result.checksum, archive_sha256: result.archive_sha256, payload_manifest_sha256: result.artifact.payload.manifest_sha256, version: result.release.version, source_commit: result.release.source_commit }, null, 2));
