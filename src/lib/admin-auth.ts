export function isAuthenticated(request: Request): boolean {
  const cookie = request.headers.get('cookie') ?? '';
  const match = cookie.match(/admin_session=([^;]+)/);
  if (!match) return false;
  const adminPassword = process.env.ADMIN_PASSWORD;
  if (!adminPassword) return false;
  return decodeURIComponent(match[1]!) === adminPassword;
}
