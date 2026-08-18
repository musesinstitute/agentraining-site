function decodeJwtPayload(token: string) {
  try {
    const part = token.split('.')[1];
    if (!part) return null;
    const base64 = part.replace(/-/g, '+').replace(/_/g, '/').padEnd(Math.ceil(part.length / 4) * 4, '=');
    return JSON.parse(atob(base64));
  } catch {
    return null;
  }
}

export default async (request: Request, context: any) => {
  const authorization = request.headers.get('authorization') || '';
  const match = authorization.match(/^Bearer\s+(.+)$/i);
  if (!match) {
    return Response.json({ error: 'Please sign in to continue.' }, { status: 401 });
  }

  // This edge gate only enforces team membership. The downstream pilot-data
  // function still performs the authoritative Netlify Identity authentication.
  // A forged JWT therefore cannot gain access: it may pass this claim check,
  // but it will fail getUser() in the authenticated function.
  const payload = decodeJwtPayload(match[1]);
  const roles = Array.isArray(payload?.app_metadata?.roles)
    ? payload.app_metadata.roles
    : Array.isArray(payload?.roles) ? payload.roles : [];
  const teamRoles = roles.filter((role: unknown) => typeof role === 'string' && role.startsWith('team-'));

  if (teamRoles.length !== 1) {
    return Response.json({
      error: teamRoles.length === 0
        ? 'Pilot team access is not configured for this account.'
        : 'Multiple Pilot team roles are not allowed.'
    }, { status: 403 });
  }

  return context.next();
};
