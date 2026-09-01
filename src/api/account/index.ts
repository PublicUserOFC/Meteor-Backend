import express, { Request, Response, Router } from 'express';
import jwt from 'jsonwebtoken';
import { createError } from '../../core/errors';
import { DecodeBase64, MakeID } from '../../core/utils';
import { AuthRequest } from '../../types';
import { User } from '../../models/User';
import { validateExchangeCode } from '../../core/users';
import { config } from '../../config';

const router: Router = express.Router();

router.post('/account/api/oauth/token', async (req: Request, res: Response) => {
  let clientId: string;
  try {
    const decoded = DecodeBase64((req.headers['authorization'] as string).split(' ')[1]);
    const parts = decoded.split(':');
    if (!parts[1]) throw new Error();
    clientId = parts[0];
  } catch {
    return createError('errors.com.epicgames.common.oauth.invalid_client', 'Invalid Authorization header.', [], 1011, 'invalid_client', 400, res);
  }

  switch (req.body.grant_type) {
    case 'client_credentials':
      return res.json({ access_token: `eg1~${MakeID()}`, expires_in: 14400, expires_at: new Date(Date.now() + 14400000).toISOString(), token_type: 'bearer', client_id: clientId, internal_client: true, client_service: 'fortnite' });

    case 'password': {
      if (!req.body.username || !req.body.password)
        return createError('errors.com.epicgames.common.oauth.invalid_request', 'Username/password is required.', [], 1013, 'invalid_request', 400, res);
      try {
        const user = await User.findOne({ $or: [{ username_lower: req.body.username.toLowerCase() }, { email: req.body.username.toLowerCase() }] });
        if (!user) { return createError('errors.com.epicgames.account.invalid_account_credentials', 'Invalid username or password.', [], 18031, 'invalid_grant', 400, res); }
        if (!await Bun.password.verify(req.body.password, user.password)) { return createError('errors.com.epicgames.account.invalid_account_credentials', 'Invalid username or password.', [], 18031, 'invalid_grant', 400, res); }
        if (user.banned) return createError('errors.com.epicgames.account.account_banned', 'Your account has been banned.', [], 18032, 'account_banned', 403, res);
        const token = jwt.sign({ accountId: user.accountId, username: user.username, email: user.email, matchmakingId: user.matchmakingId, creation_date: new Date().toISOString(), hours_expire: 8 }, config.jwtSecret, { expiresIn: '8h' });
        const deviceId = MakeID().replace(/-/gi, '');
        global.accessTokens.push({ token, accountId: user.accountId });
        return res.json({ access_token: `eg1~${token}`, expires_in: 28800, expires_at: new Date(Date.now() + 28800000).toISOString(), token_type: 'bearer', refresh_token: `eg1~${MakeID()}`, refresh_expires: 86400, refresh_expires_at: new Date(Date.now() + 86400000).toISOString(), account_id: user.accountId, client_id: clientId, internal_client: true, client_service: 'prod-fn', displayName: user.username, app: 'prod-fn', in_app_id: user.accountId, device_id: deviceId, product_id: 'prod-fn', application_id: 'fghi4567FNFBKFz3E4TROb0bmPS8h1GW', scope: ['basic_profile', 'friends_list', 'openid', 'presence'], acr: 'urn:epic:loa:aal1', auth_time: '1999-01-12T00:20:15.542Z' });
      } catch (e) { return createError('errors.com.epicgames.common.server_error', 'Internal server error', [], 1000, 'server_error', 500, res); }
    }

    case 'exchange_code': {
      if (!req.body.exchange_code) return createError('errors.com.epicgames.common.oauth.invalid_request', 'Exchange code is required.', [], 1013, 'invalid_request', 400, res);
      try {
        let accountId: string | null = null;
        try {
          const decoded = jwt.verify(req.body.exchange_code, config.jwtSecret) as any;
          if (decoded?.type === 'exchange' && decoded?.accountId) accountId = decoded.accountId;
        } catch {}

        if (!accountId) accountId = validateExchangeCode(req.body.exchange_code);
        if (!accountId) return createError('errors.com.epicgames.account.invalid_exchange_code', 'Invalid or expired exchange code.', [], 18057, 'invalid_grant', 400, res);

        const user = await User.findOne({ accountId });
        if (!user) return createError('errors.com.epicgames.account.account_not_found', 'Account not found.', [], 18007, 'invalid_grant', 400, res);
        if (user.banned) return createError('errors.com.epicgames.account.account_banned', 'Your account has been banned.', [], 18032, 'account_banned', 403, res);
        const token = jwt.sign({ accountId: user.accountId, username: user.username, email: user.email, matchmakingId: user.matchmakingId, creation_date: new Date().toISOString(), hours_expire: 8 }, config.jwtSecret, { expiresIn: '8h' });
        const deviceId = MakeID().replace(/-/gi, '');
        global.accessTokens.push({ token, accountId: user.accountId });
        return res.json({ access_token: `eg1~${token}`, expires_in: 28800, expires_at: new Date(Date.now() + 28800000).toISOString(), token_type: 'bearer', refresh_token: `eg1~${MakeID()}`, refresh_expires: 86400, refresh_expires_at: new Date(Date.now() + 86400000).toISOString(), account_id: user.accountId, client_id: clientId, internal_client: true, client_service: 'prod-fn', displayName: user.username, app: 'prod-fn', in_app_id: user.accountId, device_id: deviceId, product_id: 'prod-fn', application_id: 'fghi4567FNFBKFz3E4TROb0bmPS8h1GW', scope: ['basic_profile', 'friends_list', 'openid', 'presence'], acr: 'urn:epic:loa:aal1', auth_time: '1999-01-12T00:20:15.542Z' });
      } catch (e) { return createError('errors.com.epicgames.common.server_error', 'Internal server error', [], 1000, 'server_error', 500, res); }
    }

    case 'refresh_token': {
      let accountId: string | undefined;
      try {
        const rt = (req.body.refresh_token || '').replace('eg1~', '');
        const decoded = jwt.decode(rt) as any;
        if (decoded?.accountId) accountId = decoded.accountId;
        else if (decoded?.sub) accountId = decoded.sub;
      } catch {}
      const fakeId = accountId || MakeID().replace(/-/g, '');
      const token = jwt.sign({ accountId: fakeId, creation_date: new Date().toISOString(), hours_expire: 8 }, config.jwtSecret, { expiresIn: '8h' });
      return res.json({ access_token: `eg1~${token}`, expires_in: 28800, expires_at: new Date(Date.now() + 28800000).toISOString(), token_type: 'bearer', refresh_token: `eg1~${MakeID()}`, refresh_expires: 86400, refresh_expires_at: new Date(Date.now() + 86400000).toISOString(), account_id: fakeId, client_id: clientId, internal_client: true, client_service: 'prod-fn', app: 'prod-fn', in_app_id: fakeId, product_id: 'prod-fn', application_id: 'fghi4567FNFBKFz3E4TROb0bmPS8h1GW', scope: ['basic_profile', 'friends_list', 'openid', 'presence'], acr: 'urn:epic:loa:aal1', auth_time: '1999-01-12T00:20:15.542Z' });
    }

    case 'device_auth': {
      const devAccountId = req.body.account_id;
      const fakeId = devAccountId || MakeID().replace(/-/g, '');
      try {
        const user = await User.findOne({ accountId: fakeId });
        if (user) {
          if (user.banned) return createError('errors.com.epicgames.account.account_banned', 'Your account has been banned.', [], 18032, 'account_banned', 403, res);
          const token = jwt.sign({ accountId: user.accountId, username: user.username, email: user.email, matchmakingId: user.matchmakingId, creation_date: new Date().toISOString(), hours_expire: 8 }, config.jwtSecret, { expiresIn: '8h' });
          global.accessTokens.push({ token, accountId: user.accountId });
          return res.json({ access_token: `eg1~${token}`, expires_in: 28800, expires_at: new Date(Date.now() + 28800000).toISOString(), token_type: 'bearer', refresh_token: `eg1~${MakeID()}`, refresh_expires: 86400, refresh_expires_at: new Date(Date.now() + 86400000).toISOString(), account_id: user.accountId, client_id: clientId, internal_client: true, client_service: 'prod-fn', displayName: user.username, app: 'prod-fn', in_app_id: user.accountId, device_id: MakeID().replace(/-/gi, ''), product_id: 'prod-fn', application_id: 'fghi4567FNFBKFz3E4TROb0bmPS8h1GW', scope: ['basic_profile', 'friends_list', 'openid', 'presence'], acr: 'urn:epic:loa:aal1', auth_time: '1999-01-12T00:20:15.542Z' });
        }
      } catch {}
      const devToken = jwt.sign({ accountId: fakeId, creation_date: new Date().toISOString(), hours_expire: 8 }, config.jwtSecret, { expiresIn: '8h' });
      return res.json({ access_token: `eg1~${devToken}`, expires_in: 28800, expires_at: new Date(Date.now() + 28800000).toISOString(), token_type: 'bearer', refresh_token: `eg1~${MakeID()}`, refresh_expires: 86400, refresh_expires_at: new Date(Date.now() + 86400000).toISOString(), account_id: fakeId, client_id: clientId, internal_client: true, client_service: 'prod-fn', app: 'prod-fn', in_app_id: fakeId, product_id: 'prod-fn', application_id: 'fghi4567FNFBKFz3E4TROb0bmPS8h1GW', scope: ['basic_profile', 'friends_list', 'openid', 'presence'], acr: 'urn:epic:loa:aal1', auth_time: '1999-01-12T00:20:15.542Z' });
    }

    case 'external_auth': {
      let accountId: string | undefined;
      try {
        const token = (req.body.external_auth_token || '').replace('eg1~', '');
        if (token) {
          const decoded = jwt.verify(token, config.jwtSecret) as any;
          accountId = decoded.accountId;
        }
      } catch {}
      const token = accountId
        ? jwt.sign({ accountId, creation_date: new Date().toISOString(), hours_expire: 8 }, config.jwtSecret, { expiresIn: '8h' })
        : MakeID();
      return res.json({
        access_token: `eg1~${token}`,
        expires_in: 28800,
        expires_at: new Date(Date.now() + 28800000).toISOString(),
        token_type: 'bearer',
        refresh_token: `eg1~${MakeID()}`,
        refresh_expires: 86400,
        refresh_expires_at: new Date(Date.now() + 86400000).toISOString(),
        account_id: accountId || MakeID().replace(/-/g, ''),
        client_id: clientId,
        internal_client: true,
        client_service: 'prod-fn',
        app: 'prod-fn',
        in_app_id: accountId || MakeID().replace(/-/g, ''),
        product_id: 'prod-fn',
        application_id: 'fghi4567FNFBKFz3E4TROb0bmPS8h1GW',
        scope: ['basic_profile', 'friends_list', 'openid', 'presence'],
        acr: 'urn:epic:loa:aal1',
        auth_time: '1999-01-12T00:20:15.542Z',
      });
    }

    default:
      return createError('errors.com.epicgames.common.oauth.unsupported_grant_type', `Unsupported grant type: ${req.body.grant_type}`, [], 1016, 'unsupported_grant_type', 400, res);
  }
});

router.get('/account/api/oauth/verify', async (req: AuthRequest, res: Response) => {
  const authHeader = req.headers['authorization'];
  if (!authHeader) return createError('errors.com.epicgames.common.authentication.authentication_failed', 'Authentication failed', [], 1032, 'invalid_token', 401, res);
  const token = authHeader.replace(/bearer /i, '').replace('eg1~', '');
  try {
    const decoded = jwt.verify(token, config.jwtSecret) as any;
    res.json({ token: authHeader.replace(/bearer /i, ''), session_id: MakeID(), token_type: 'bearer', client_id: decoded.clientId || 'ec684b8c687f479fadea3cb2ad83f5c6', internal_client: true, client_service: 'prod-fn', account_id: decoded.accountId, expires_in: 28800, expires_at: new Date(Date.now() + 28800000).toISOString(), auth_method: 'exchange_code', display_name: decoded.username, app: 'prod-fn', in_app_id: decoded.accountId, device_id: '89776e294d5c27ba1ef4e59fab402ea7', scope: ['basic_profile', 'friends_list', 'openid', 'presence'], product_id: 'prod-fn', sandbox_id: 'fn', deployment_id: '62a9473a2dca46b29ccf17577fcf42d7', application_id: 'fghi4567FNFBKFz3E4TROb0bmPS8h1GW', acr: 'urn:epic:loa:aal1', auth_time: '1999-01-12T00:20:15.542Z' });
  } catch { return createError('errors.com.epicgames.common.authentication.token_verification_failed', 'Sorry, we could not validate your token.', [], 1014, 'invalid_token', 401, res); }
});

router.delete('/account/api/oauth/sessions/kill', (_req: Request, res: Response) => {
  res.status(204).end();
});

router.delete('/account/api/oauth/sessions/*', (_req: Request, res: Response) => res.status(204).end());

router.get('/account/api/public/account/token', (_req: Request, res: Response) => res.json({ token: `eg1~${MakeID()}` }));

router.get('/account/api/public/account', async (req: Request, res: Response) => {
  try {
    const accountIds = req.query.accountId;
    if (!accountIds) return res.json([]);
    const ids = Array.isArray(accountIds) ? accountIds : [accountIds];
    const users = await User.find({ accountId: { $in: ids } }).lean();
    res.json(users.map(u => ({ id: u.accountId, displayName: u.username, externalAuths: {} })));
  } catch { res.json([]); }
});

router.get('/account/api/public/account/:accountId', async (req: Request, res: Response) => {
  try {
    const user = await User.findOne({ accountId: req.params.accountId }).lean();
    if (!user) return createError('errors.com.epicgames.account.account_not_found', `Account ${req.params.accountId} not found`, [], 18007, 'not_found', 404, res);
    res.json({ id: user.accountId, displayName: user.username, name: user.username, email: user.email, failedLoginAttempts: 0, lastLogin: new Date().toISOString(), numberOfDisplayNameChanges: 0, ageGroup: 'UNKNOWN', headless: false, country: 'US', lastName: 'User', preferredLanguage: 'en', canUpdateDisplayName: false, tfaEnabled: false, emailVerified: true, minorVerified: false, minorExpected: false, minorStatus: 'NOT_MINOR', cabinedMode: false, hasHashedEmail: false });
  } catch { return createError('errors.com.epicgames.common.server_error', 'Internal server error', [], 1000, 'server_error', 500, res); }
});

router.get('/account/api/public/account/:accountId/externalAuths', (_req: Request, res: Response) => res.json([]));
router.delete('/account/api/public/account/:accountId/externalAuths/:type', (_req: Request, res: Response) => res.status(204).end());

router.get('/account/api/public/account/displayName/:displayName', async (req: Request, res: Response) => {
  try {
    const user = await User.findOne({ username_lower: req.params.displayName.toLowerCase() }).lean();
    if (!user) return res.json({ id: 'mock-account-id', displayName: req.params.displayName, externalAuths: {} });
    return res.json({ id: user.accountId, displayName: user.username, externalAuths: {} });
  } catch { return res.json({ id: 'mock-account-id', displayName: req.params.displayName, externalAuths: {} }); }
});

router.get('/persona/api/public/account/lookup', async (req: Request, res: Response) => {
  try {
    const q = req.query.q as string;
    if (!q) return res.json({ id: 'mock-account-id', displayName: q, externalAuths: {} });
    const user = await User.findOne({ username_lower: q.toLowerCase() }).lean();
    if (!user) return res.json({ id: 'mock-account-id', displayName: q, externalAuths: {} });
    return res.json({ id: user.accountId, displayName: user.username, externalAuths: {} });
  } catch { return res.json({ id: 'mock-account-id', displayName: req.query.q, externalAuths: {} }); }
});

router.get('/account/api/epicdomains/ssodomains', (_req: Request, res: Response) => res.json(['unrealengine.com', 'unrealtournament.com', 'fortnite.com', 'epicgames.com']));

router.get('/account/api/oauth/exchange', async (req: AuthRequest, res: Response) => {
  const authHeader = req.headers['authorization'];
  if (!authHeader) return createError('errors.com.epicgames.common.authentication.authentication_failed', 'Authentication failed', [], 1032, 'invalid_token', 401, res);
  try {
    const token = (authHeader as string).replace(/bearer /i, '').replace('eg1~', '');
    const decoded = jwt.verify(token, config.jwtSecret) as any;
    const accountId = decoded.accountId;
    const exchangeToken = jwt.sign({ accountId, type: 'exchange' }, config.jwtSecret, { expiresIn: '5m' });
    return res.json({ expiresInSeconds: 300, code: exchangeToken, creatingClientId: 'ec684b8c687f479fadea3cb2ad83f5c6' });
  } catch { return createError('errors.com.epicgames.common.authentication.token_verification_failed', 'Token verification failed', [], 1014, 'invalid_token', 401, res); }
});

router.post('/account/api/public/account/:accountId/deviceAuth', async (req: Request, res: Response) => {
  const { v4: uuidv4 } = require('uuid');
  const deviceId = uuidv4().replace(/-/g, '');
  const secret = require('crypto').randomBytes(20).toString('hex').toUpperCase();
  return res.json({ deviceId, accountId: req.params.accountId, secret, userAgent: req.headers['user-agent'] || '', created: { location: 'Unknown', ipAddress: '127.0.0.1', dateTime: new Date().toISOString() } });
});
router.get('/account/api/public/account/:accountId/deviceAuth', (_req: Request, res: Response) => res.json([]));
router.get('/account/api/public/account/:accountId/deviceAuth/:deviceId', (req: Request, res: Response) => res.json({ deviceId: req.params.deviceId, accountId: req.params.accountId }));
router.delete('/account/api/public/account/:accountId/deviceAuth/:deviceId', (_req: Request, res: Response) => res.status(204).end());

router.get('/account/api/public/account/:accountId/metadata', (req: Request, res: Response) => res.json({ accountId: req.params.accountId, metadata: {} }));
router.put('/account/api/public/account/:accountId/metadata', (_req: Request, res: Response) => res.status(204).end());

router.post('/auth/v1/oauth/token', async (req: Request, res: Response) => {
  try {
    const grantType = req.body?.grant_type as string | undefined;
    const deploymentId = (req.body?.deployment_id as string | undefined) || '62a9473a2dca46b29ccf17577fcf42d7';

    // client_credentials — just return a simple client token (no id_token needed)
    if (grantType === 'client_credentials') {
      const clientToken = jwt.sign({
        clientId: '3e13c5c57f594a578abe516eecb673fe',
        productId: '3fd15bc288014f698cca1a3d1f01c7af',
        iss: 'eos',
        env: 'prod',
        organizationId: 'o-aa83a0a9bc45e98c80c1b1c9d92e9e',
        features: ['AntiCheat', 'Connect', 'ContentService', 'Ecom', 'EpicConnect', 'Inventories', 'LockerService', 'Matchmaking Service', 'ExchangeCodeCreation', 'Achievements', 'Leaderboards', 'Matchmaking', 'Metrics', 'PlayerReports', 'Sanctions', 'Stats', 'TitleStorage', 'Voice', 'CommerceService', 'FNResonanceService', 'MagpieService', 'PCBService', 'QuestService'],
        deploymentId,
        sandboxId: 'fn',
        tokenType: 'clientToken',
        exp: 2147483647,
        iat: Math.floor(Date.now() / 1000),
        jti: MakeID().replace(/-/g, ''),
      }, 'RS256', { keyid: '2022-06-14T06:17:57.047928700Z' });

      return res.json({
        access_token: clientToken,
        token_type: 'bearer',
        expires_in: 3599,
        expires_at: '9999-12-31T23:59:59.999Z',
        features: ['AntiCheat', 'Connect', 'ContentService', 'Ecom', 'EpicConnect', 'Inventories', 'LockerService', 'Matchmaking Service', 'ExchangeCodeCreation', 'Achievements', 'Leaderboards', 'Matchmaking', 'Metrics', 'PlayerReports', 'Sanctions', 'Stats', 'TitleStorage', 'Voice', 'CommerceService', 'FNResonanceService', 'MagpieService', 'PCBService', 'QuestService'],
        organization_id: 'o-aa83a0a9bc45e98c80c1b1c9d92e9e',
        product_id: 'prod-fn',
        sandbox_id: 'fn',
        deployment_id: deploymentId,
      });
    }

    // external_auth / refresh_token — return full user token with id_token
    let accountId: string | undefined;
    const authHeaderV1 = req.headers['authorization'] as string | undefined;
    if (authHeaderV1) {
      try {
        const raw = authHeaderV1.replace(/bearer /i, '').replace('eg1~', '');
        const decoded = jwt.verify(raw, config.jwtSecret) as any;
        accountId = decoded.accountId || decoded.sub || decoded.dn;
      } catch {
        try { const d = jwt.decode(authHeaderV1.replace(/bearer /i, '').replace('eg1~', '')) as any; accountId = d?.accountId || d?.sub || d?.dn; } catch {}
      }
    }
    if (!accountId && req.body?.external_auth_token) {
      try {
        const raw = (req.body.external_auth_token as string).replace('eg1~', '');
        const d = jwt.decode(raw) as any;
        accountId = d?.accountId || d?.sub || d?.dn;
      } catch {}
    }
    if (!accountId && req.body?.refresh_token) {
      try {
        const d = jwt.decode((req.body.refresh_token as string).replace('eg1~', '')) as any;
        accountId = d?.accountId || d?.sub || d?.dn || d?.account?.id;
      } catch {}
    }

    const displayName = accountId || 'Player';
    const nonce = (req.body?.nonce as string | undefined) || MakeID().replace(/-/g, '');
    const productUserId = '00027b91959a4c57a1272efcc4d7480f';
    const orgUserId = '000185f80b9a4dc3aaf1ca83611c2bf5';
    const serverBase = `http://127.0.0.1:${config.port}`;

    const accessToken = jwt.sign({
      clientId: 'ec684b8c687f479fadea3cb2ad83f5c6',
      role: 'GameClient',
      productId: 'prod-fn',
      iss: 'eos',
      env: 'prod',
      nonce,
      organizationId: 'o-aa83a0a9bc45e98c80c1b1c9d92e9e',
      features: ['AntiCheat', 'Connect', 'ContentService', 'Ecom', 'EpicConnect', 'Inventories', 'LockerService', 'Matchmaking Service', 'ExchangeCodeCreation', 'Achievements', 'Leaderboards', 'Matchmaking', 'Metrics', 'PlayerReports', 'Sanctions', 'Stats', 'TitleStorage', 'Voice', 'CommerceService', 'FNResonanceService', 'MagpieService', 'PCBService', 'QuestService'],
      productUserId,
      organizationUserId: orgUserId,
      clientIp: '127.0.0.1',
      deploymentId,
      sandboxId: 'fn',
      tokenType: 'userToken',
      exp: 2147483647,
      iat: Math.floor(Date.now() / 1000),
      account: { idp: 'epicgames', displayName, id: displayName, plf: 'other' },
      jti: MakeID().replace(/-/g, ''),
    }, 'RS256', { keyid: '2022-06-14T06:17:57.047928700Z' });

    const idToken = jwt.sign({
      aud: 'ec684b8c687f479fadea3cb2ad83f5c6',
      sub: productUserId,
      pfsid: 'fn',
      act: { pltfm: 'other', eaid: displayName, eat: 'epicgames' },
      pfdid: deploymentId,
      iss: `${serverBase}/auth/v1/oauth`,
      exp: 2147483647,
      tokenType: 'idToken',
      iat: Math.floor(Date.now() / 1000),
      pfpid: 'prod-fn',
    }, 'RS256', { keyid: '2022-06-14T06:17:57.047928700Z' });

    return res.json({
      access_token: accessToken,
      token_type: 'bearer',
      expires_in: 3599,
      expires_at: '9999-12-31T23:59:59.999Z',
      nonce,
      features: ['AntiCheat', 'Connect', 'ContentService', 'Ecom', 'EpicConnect', 'Inventories', 'LockerService', 'Matchmaking Service', 'ExchangeCodeCreation', 'Achievements', 'Leaderboards', 'Matchmaking', 'Metrics', 'PlayerReports', 'Sanctions', 'Stats', 'TitleStorage', 'Voice', 'CommerceService', 'FNResonanceService', 'MagpieService', 'PCBService', 'QuestService'],
      organization_id: 'o-aa83a0a9bc45e98c80c1b1c9d92e9e',
      product_id: 'prod-fn',
      sandbox_id: 'fn',
      deployment_id: deploymentId,
      organization_user_id: orgUserId,
      product_user_id: productUserId,
      product_user_id_created: false,
      id_token: idToken,
    });
  } catch {
    return createError('errors.com.epicgames.common.server_error', 'Internal server error', [], 1000, 'server_error', 500, res);
  }
});

router.post('/epic/oauth/v2/token', async (req: Request, res: Response) => {
  console.log('[EOS OAuth v2] Request body:', JSON.stringify(req.body, null, 2));
  console.log('[EOS OAuth v2] Grant type:', req.body?.grant_type);
  
  // Get account ID from refresh token
  let accountId = 'default_user';
  let displayName = 'default_user';
  if (req.body?.refresh_token) {
    try {
      const token = req.body.refresh_token.replace('eg1~', '');
      const decoded = jwt.decode(token) as any;
      accountId = decoded?.accountId || decoded?.sub || 'default_user';
      displayName = decoded?.username || decoded?.dn || accountId;
    } catch {}
  }
  
  // Generate proper EOS tokens like Neonite
  const access_token = jwt.sign({
    "sub": accountId,
    "pfsid": "a01927f7421a4d4995673fe30ef46945",
    "iss": "http://127.0.0.1:5353/auth/v1/oauth",
    "dn": displayName,
    "nonce": "n-TRePC1vU+xUVFrVbZbqJVk6T2MU=",
    "pfpid": "86f32f1151354e7cb39c12f8ab2c22a3",
    "sec": 1,
    "aud": "xyza7891REBVsEqSJRRNXmlS7EQHM459",
    "pfdid": "a652a72ea1664dcab3a467891eea5f30",
    "t": "epic_id",
    "scope": "basic_profile openid offline_access",
    "appid": "fghi45672f0QV6b6B1KntLd7JR7RFLWc",
    "exp": 2147483647,
    "iat": Math.floor(Date.now() / 1000),
    "jti": MakeID().replace(/-/g, '')
  }, "RS256");
  
  const refresh_token = jwt.sign({
    "sub": accountId,
    "dn": displayName,
    "t": "refresh",
    "exp": 2147483647,
    "iat": Math.floor(Date.now() / 1000)
  }, "RS256");
  
  const id_token = jwt.sign({
    "aud": "ec684b8c687f479fadea3cb2ad83f5c6",
    "sub": "00027b91959a4c57a1272efcc4d7480f",
    "pfsid": "fn",
    "act": {
      "pltfm": "other",
      "eaid": accountId,
      "eat": "epicgames"
    },
    "iss": "http://127.0.0.1:5353/auth/v1/oauth",
    "exp": 2147483647,
    "iat": Math.floor(Date.now() / 1000),
    "jti": MakeID().replace(/-/g, '')
  }, "RS256");
  
  const response = {
    scope: req.body?.scope || 'basic_profile friends_list openid presence offline_access',
    token_type: 'bearer',
    access_token,
    refresh_token,
    id_token,
    expires_in: 7200,
    expires_at: '9999-12-31T23:59:59.999Z',
    refresh_expires_in: 28800,
    refresh_expires_at: '9999-12-31T23:59:59.999Z',
    account_id: accountId,
    client_id: 'ec684b8c687f479fadea3cb2ad83f5c6',
    application_id: 'fghi4567FNFBKFz3E4TROb0bmPS8h1GW',
    selected_account_id: accountId,
    merged_accounts: [],
    features: [
      "AntiCheat",
      "Connect",
      "ContentService",
      "Ecom",
      "EpicConnect",
      "Inventories",
      "LockerService",
      "Matchmaking Service",
      "ExchangeCodeCreation",
      "Achievements",
      "Leaderboards",
      "Matchmaking",
      "Metrics",
      "PlayerReports",
      "Sanctions",
      "Stats",
      "TitleStorage",
      "Voice",
      "CommerceService",
      "FNResonanceService",
      "MagpieService",
      "PCBService",
      "QuestService"
    ],
    organization_id: "o-aa83a0a9bc45e98c80c1b1c9d92e9e",
    product_id: "prod-fn",
    sandbox_id: "fn",
    deployment_id: req.body?.deployment_id || "62a9473a2dca46b29ccf17577fcf42d7"
  };
  
  console.log('[EOS OAuth v2] Returning Better-Reload format response');
  return res.json(response);
});

router.post('/epic/oauth/v2/revoke', (req: Request, res: Response) => {
  console.log('[EOS OAuth v2] Revoke token request');
  res.status(204).end();
});

router.get('/auth/v1/oauth/verify', (req: Request, res: Response) => {
  const authHeader = req.headers['authorization'] as string | undefined;
  if (!authHeader) return res.status(401).json({ error: 'unauthorized' });
  try {
    const raw = authHeader.replace(/bearer /i, '').replace('eg1~', '');
    // EOS tokens are signed with 'RS256' string — just decode without verify
    const decoded = jwt.decode(raw) as any;
    const accountId = decoded?.account?.id || decoded?.accountId || decoded?.sub || 'unknown';
    return res.json({
      token: authHeader.replace(/bearer /i, ''),
      token_type: 'bearer',
      client_id: 'ec684b8c687f479fadea3cb2ad83f5c6',
      account_id: accountId,
      expires_in: 28800,
      expires_at: '9999-12-31T23:59:59.999Z',
      product_id: 'prod-fn',
      sandbox_id: 'fn',
      deployment_id: '62a9473a2dca46b29ccf17577fcf42d7',
    });
  } catch {
    return res.status(401).json({ error: 'invalid_token' });
  }
});

// EOS SDK fetches these to validate id_token — return empty JWKS so alg:none tokens pass
router.get('/epic/oauth/v2/.well-known/openid-configuration', (req: Request, res: Response) => {
  const base = `http://127.0.0.1:${config.port}`;
  res.json({
    issuer: `${base}/auth/v1/oauth`,
    authorization_endpoint: `${base}/auth/v1/oauth/authorize`,
    token_endpoint: `${base}/auth/v1/oauth/token`,
    jwks_uri: `${base}/auth/v1/oauth/.well-known/jwks.json`,
    response_types_supported: ['code'],
    subject_types_supported: ['public'],
    id_token_signing_alg_values_supported: ['HS256'],
  });
});

// EOS SDK resolves issuer well-known from the id_token iss field
router.get('/auth/v1/oauth/.well-known/openid-configuration', (req: Request, res: Response) => {
  const base = `http://127.0.0.1:${config.port}`;
  res.json({
    issuer: `${base}/auth/v1/oauth`,
    authorization_endpoint: `${base}/auth/v1/oauth/authorize`,
    token_endpoint: `${base}/auth/v1/oauth/token`,
    jwks_uri: `${base}/auth/v1/oauth/.well-known/jwks.json`,
    response_types_supported: ['code'],
    subject_types_supported: ['public'],
    id_token_signing_alg_values_supported: ['HS256'],
  });
});

router.get('/auth/v1/oauth/.well-known/jwks.json', (_req: Request, res: Response) => {
  res.json({ keys: [] });
});

router.get('/epic/oauth/v2/.well-known/jwks.json', (_req: Request, res: Response) => {
  res.json({ keys: [] });
});

// Supervised Settings endpoint - required during login flow
router.get('/account/api/public/account/:accountId/supervisedSettings', (req: Request, res: Response) => {
  console.log('[SupervisedSettings] Request received for accountId:', req.params.accountId);
  res.json({
    accountId: req.params.accountId,
    supervised: false,
    supervisedBy: null,
    canUpdateDisplayName: true,
    canUpdateAvatar: true,
    canReceiveGifts: true,
    canSendGifts: true,
    canTrade: true,
    canPurchase: true,
    requiresParentalConsent: false,
    parentEmail: null
  });
});

// Alternative endpoint paths that might be used
router.get('/account/api/public/account/:accountId/supervised-settings', (req: Request, res: Response) => {
  console.log('[SupervisedSettings] Alternative endpoint hit for accountId:', req.params.accountId);
  res.json({
    accountId: req.params.accountId,
    supervised: false,
    supervisedBy: null,
    canUpdateDisplayName: true,
    canUpdateAvatar: true,
    canReceiveGifts: true,
    canSendGifts: true,
    canTrade: true,
    canPurchase: true,
    requiresParentalConsent: false,
    parentEmail: null
  });
});

// EOS-style supervised settings endpoint
router.get('/account/api/accounts/:accountId/supervisedSettings', (req: Request, res: Response) => {
  console.log('[SupervisedSettings] EOS-style endpoint hit for accountId:', req.params.accountId);
  res.json({
    accountId: req.params.accountId,
    supervised: false,
    supervisedBy: null,
    canUpdateDisplayName: true,
    canUpdateAvatar: true,
    canReceiveGifts: true,
    canSendGifts: true,
    canTrade: true,
    canPurchase: true,
    requiresParentalConsent: false,
    parentEmail: null
  });
});

export default router;
