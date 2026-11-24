"""Short, content-free labels for a tool call: a command's own description, a file name, a host. Moved from
~/.claude/hooks/localai-progress.py so every hook derives the same label; behaviour is unchanged. Nothing from a
tool's input is returned beyond these labels, so no file content, command text or prompt can leak through here."""


def short_path(p) -> str:
    """The last two segments of a path, or '' for none."""
    p = str(p or '')
    parts = [x for x in p.replace('\\', '/').split('/') if x]
    return '/'.join(parts[-2:]) if parts else ''


def describe(tool: str, inp) -> tuple[str, str]:
    """(title, detail) for one tool call. A non-dict input is treated as empty."""
    inp = inp if isinstance(inp, dict) else {}
    if tool in ('Bash', 'PowerShell'):
        return inp.get('description') or 'Ran a command', ''
    if tool in ('Read', 'Edit', 'Write', 'NotebookEdit'):
        verb = {'Read': 'Read', 'Edit': 'Edited', 'Write': 'Wrote', 'NotebookEdit': 'Edited notebook'}[tool]
        return f"{verb} {short_path(inp.get('file_path') or inp.get('notebook_path'))}", ''
    if tool in ('Grep', 'Glob'):
        return 'Searched files', short_path(inp.get('path'))
    if tool == 'WebFetch':
        url = str(inp.get('url') or '')
        return 'Fetched ' + (url.split('/')[2] if '://' in url else 'a page'), ''
    if tool == 'WebSearch':
        return 'Web search', ''
    if tool in ('Agent', 'Task'):
        return 'Agent: ' + str(inp.get('description') or 'subtask'), ''
    if tool == 'Skill':
        return 'Skill: ' + str(inp.get('skill') or ''), ''
    if tool == 'Artifact':
        return 'Artifact ' + str(inp.get('action') or 'publish'), ''
    if tool.startswith('mcp__'):
        return tool.split('__', 2)[-1].replace('_', ' '), tool.split('__')[1] if tool.count('__') >= 2 else ''
    return tool, ''
