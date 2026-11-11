export default function handler(req, res) {
  res.setHeader('Cache-Control', 'no-store');
  res.status(200).json({
    service: 'myas-tool',
    status: 'ok',
    storage: 'browser-local',
    square: 'oauth-browser-session',
  });
}
