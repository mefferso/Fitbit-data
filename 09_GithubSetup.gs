/*
 * One-time setup helper for GitHub Actions.
 *
 * Run this manually from the Apps Script editor, copy the refresh token into
 * the GitHub repository secret GOOGLE_REFRESH_TOKEN, then delete this helper
 * from the live Apps Script project if you want.
 *
 * Never commit the printed token or paste it into an issue/chat.
 */
function logGithubRefreshTokenOnce() {
  const token = getHealthService_().getToken(true);
  const refreshToken = token && (token.refresh_token || token.refreshToken);

  if (!refreshToken) {
    throw new Error(
      'No refresh token is stored. Run disconnectHealth(), reconnect Google Health, then try this helper again.'
    );
  }

  console.log('GOOGLE_REFRESH_TOKEN=' + refreshToken);
}
