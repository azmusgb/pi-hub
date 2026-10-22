// Shared, predictable decisions for household navigation.
export function issueTopic(issue) {
  const name = issue.what || "";
  if (/movie|plex/i.test(name)) return "movies";
  if (/smart.home|homebridge/i.test(name)) return "devices";
  if (/bambu|workshop|windows|display/i.test(name)) return "workshop";
  return "system";
}

export function splitIssues(issues, expanded = false) {
  const limit = issues.length > 2 && !expanded ? 1 : issues.length;
  return { shown: issues.slice(0, limit), remaining: issues.length - limit };
}

export function unreadCount(alerts, seen) {
  return alerts.filter(a => Number.isFinite(a.ts) && a.ts > seen).length;
}
