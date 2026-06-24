// RFC 9116 security.txt — tells security researchers how to report a vulnerability.
// Served at https://esportscommunity.net/.well-known/security.txt
// NOTE: the Expires date must be refreshed before it lapses (bump it ~1 year out).
const SECURITY_TXT = `Contact: mailto:security@esportscommunity.net
Expires: 2027-06-25T00:00:00.000Z
Preferred-Languages: en, ar
Canonical: https://esportscommunity.net/.well-known/security.txt
`;

export function GET() {
  return new Response(SECURITY_TXT, {
    headers: { "Content-Type": "text/plain; charset=utf-8" },
  });
}
