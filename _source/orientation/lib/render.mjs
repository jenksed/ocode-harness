/**
 * Render orientation object as compact JSON.
 * @param {Object} orientation - The orientation object.
 * @returns {string} Compact JSON string.
 */
export function renderJson(orientation) {
  return JSON.stringify(orientation);
}

/**
 * Render orientation object as human-readable Markdown.
 * @param {Object} orientation - The orientation object.
 * @returns {string} Markdown string.
 */
export function renderMarkdown(orientation) {
  const lines = [];

  lines.push('# Project Orientation');
  lines.push('');
  lines.push(`**Schema Version:** ${orientation.schema_version}`);
  lines.push('');

  // Project
  lines.push('## Project');
  lines.push(`- **Name:** ${orientation.project.name}`);
  lines.push(`- **Root:** ${orientation.project.root}`);
  lines.push('');

  // Git
  lines.push('## Git');
  lines.push(`- **Is Repository:** ${orientation.git.is_repository}`);
  if (orientation.git.is_repository) {
    if (orientation.git.root && orientation.git.root !== orientation.project.root) {
      lines.push(`- **Root:** ${orientation.git.root}`);
    }
    lines.push(`- **Project is Git Root:** ${orientation.git.project_is_git_root}`);
    lines.push(`- **Branch:** ${orientation.git.branch || 'unknown'}`);
    lines.push(`- **HEAD:** ${orientation.git.head || 'unknown'}`);
    lines.push(`- **Dirty:** ${orientation.git.dirty}`);
  }
  lines.push('');

  // Detected
  lines.push('## Detected');
  lines.push(`- **Manifests:** ${orientation.detected.manifests.length > 0 ? orientation.detected.manifests.join(', ') : 'none'}`);
  lines.push(`- **Languages:** ${orientation.detected.languages.length > 0 ? orientation.detected.languages.join(', ') : 'none'}`);
  lines.push(`- **Package Manager:** ${orientation.detected.package_manager || 'none'}`);
  lines.push('');

  // Commands
  lines.push('## Commands');
  const cmdCategories = ['test', 'build', 'lint', 'typecheck', 'verify'];
  for (const category of cmdCategories) {
    const commands = orientation.commands[category];
    if (commands.length > 0) {
      lines.push(`- **${category}:**`);
      for (const cmd of commands) {
        lines.push(`  - \`${cmd}\``);
      }
    } else {
      lines.push(`- **${category}:** none`);
    }
  }
  lines.push('');

  // Authority
  lines.push('## Authority Files');
  if (orientation.authority.length > 0) {
    for (const file of orientation.authority) {
      lines.push(`- ${file}`);
    }
  } else {
    lines.push('none');
  }
  lines.push('');

  // Directories
  lines.push('## Directories');
  if (orientation.directories.length > 0) {
    for (const dir of orientation.directories) {
      lines.push(`- ${dir}`);
    }
  } else {
    lines.push('none');
  }
  lines.push('');

  return lines.join('\n');
}