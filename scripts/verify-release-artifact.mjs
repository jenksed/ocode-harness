import { resolve } from 'node:path';
import { verifyReleaseArtifact } from './release-artifact.mjs';
const artifact = process.argv[2]; if (!artifact) throw new Error('Usage: npm run release:verify -- <artifact>');
const result = verifyReleaseArtifact(resolve(artifact)); console.log(`ARTIFACT_VERIFIED ${result.release.version} ${result.release.source_commit} ${result.artifact.payload.manifest_sha256}`);
