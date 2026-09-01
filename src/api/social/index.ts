import { Router, Request, Response } from 'express';
import { Friends } from '../../models/Friends';
import { User } from '../../models/User';
import * as friendManager from '../../core/friends';
import * as partyManager from '../../core/party';
import { verifyToken } from '../../middleware/auth';

const router = Router();

// ── Presence / misc stubs ─────────────────────────────────────────────────────

router.get('/friends/api/v1/*/settings', (_req, res) => res.json({ acceptInvites: 'public', mutualPrivacy: 'ALL' }));
router.put('/friends/api/v1/:accountId/settings', verifyToken, (_req, res) => res.json({ acceptInvites: 'public', mutualPrivacy: 'ALL' }));
router.patch('/friends/api/v1/:accountId/settings', verifyToken, (_req, res) => res.json({ acceptInvites: 'public', mutualPrivacy: 'ALL' }));
router.get('/friends/api/v1/*/blocklist', verifyToken, async (req, res) => {
  const friends = await Friends.findOne({ accountId: req.user?.accountId }).lean();
  res.json({ blockedUsers: friends?.list.blocked.map((f: any) => f.accountId) ?? [] });
});
router.get('/friends/api/public/list/fortnite/*/recentPlayers', (_req, res) => res.json([]));
router.all('/friends/api/v1/*/friends/:friendId/alias', verifyToken, (_req, res) => res.status(204).end());

// ── Friends list endpoints ────────────────────────────────────────────────────

router.get('/friends/api/v1/:accountId/friends', verifyToken, async (req, res) => {
  const friends = await Friends.findOne({ accountId: req.params.accountId }).lean();
  if (!friends) return res.json([]);
  res.json(friends.list.accepted.map((f: any) => ({
    accountId: f.accountId,
    groups: [],
    alias: f.alias || '',
    note: '',
    favorite: false,
    created: f.created,
  })));
});

router.get('/friends/api/v1/:accountId/incoming', verifyToken, async (req, res) => {
  const friends = await Friends.findOne({ accountId: req.params.accountId }).lean();
  if (!friends) return res.json([]);
  res.json(friends.list.incoming.map((f: any) => ({
    accountId: f.accountId,
    mutual: 0,
    favorite: false,
    created: f.created,
  })));
});

router.get('/friends/api/v1/:accountId/outgoing', verifyToken, async (req, res) => {
  const friends = await Friends.findOne({ accountId: req.params.accountId }).lean();
  if (!friends) return res.json([]);
  res.json(friends.list.outgoing.map((f: any) => ({
    accountId: f.accountId,
    favorite: false,
    created: f.created,
  })));
});

router.get('/friends/api/v1/:accountId/relations', verifyToken, async (req, res) => {
  const friends = await Friends.findOne({ accountId: req.params.accountId }).lean();
  if (!friends) return res.json([]);
  const relations: any[] = [];
  friends.list.accepted.forEach((f: any) => relations.push({ accountId: f.accountId, status: 'ACCEPTED', direction: 'OUTBOUND', created: f.created, favorite: false }));
  friends.list.incoming.forEach((f: any) => relations.push({ accountId: f.accountId, status: 'PENDING', direction: 'INBOUND', created: f.created, favorite: false }));
  friends.list.outgoing.forEach((f: any) => relations.push({ accountId: f.accountId, status: 'PENDING', direction: 'OUTBOUND', created: f.created, favorite: false }));
  res.json(relations);
});

router.get('/friends/api/v1/:accountId/summary', verifyToken, async (req, res) => {
  const response: any = {
    friends: [], incoming: [], outgoing: [], suggested: [], blocklist: [],
    settings: { acceptInvites: 'public', mutualPrivacy: 'ALL' },
    limitsReached: { incoming: false, outgoing: false, accepted: false },
  };
  const friends = await Friends.findOne({ accountId: req.user.accountId }).lean();
  if (!friends) return res.json(response);
  friends.list.accepted.forEach((f: any) => response.friends.push({ accountId: f.accountId, groups: [], mutual: 0, alias: f.alias || '', note: '', favorite: false, created: f.created }));
  friends.list.incoming.forEach((f: any) => response.incoming.push({ accountId: f.accountId, mutual: 0, favorite: false, created: f.created }));
  friends.list.outgoing.forEach((f: any) => response.outgoing.push({ accountId: f.accountId, favorite: false, created: f.created }));
  friends.list.blocked.forEach((f: any) => response.blocklist.push({ accountId: f.accountId }));
  res.json(response);
});

router.get('/friends/api/public/friends/:accountId', verifyToken, async (req, res) => {
  const friends = await Friends.findOne({ accountId: req.params.accountId }).lean();
  if (!friends) return res.json([]);
  res.json(friends.list.accepted.map((f: any) => ({
    accountId: f.accountId,
    status: 'ACCEPTED',
    direction: 'OUTBOUND',
    created: f.created || new Date().toISOString(),
    favorite: false,
  })));
});

router.get('/friends/api/public/blocklist/*', verifyToken, async (req, res) => {
  const friends = await Friends.findOne({ accountId: req.user.accountId }).lean();
  res.json({ blockedUsers: friends?.list.blocked.map((f: any) => f.accountId) ?? [] });
});

// ── Friend add / remove / block ───────────────────────────────────────────────

router.post('/friends/api/*/friends/:receiverId', verifyToken, async (req, res) => {
  const senderId = req.user.accountId;
  const receiverId = req.params.receiverId;

  const defaultList = { accepted: [], incoming: [], outgoing: [], blocked: [] };

  await Promise.all([
    Friends.findOneAndUpdate(
      { accountId: senderId },
      { $setOnInsert: { accountId: senderId, list: defaultList } },
      { upsert: true, new: true }
    ),
    Friends.findOneAndUpdate(
      { accountId: receiverId },
      { $setOnInsert: { accountId: receiverId, list: defaultList } },
      { upsert: true, new: true }
    ),
  ]);

  const sender = await Friends.findOne({ accountId: senderId });
  if (!sender) return res.status(403).end();

  if (sender.list.incoming.find((f: any) => f.accountId === receiverId)) {
    if (!await friendManager.acceptFriendReq(senderId, receiverId)) return res.status(403).end();
  } else if (!sender.list.outgoing.find((f: any) => f.accountId === receiverId)) {
    if (!await friendManager.sendFriendReq(senderId, receiverId)) return res.status(403).end();
  }

  res.status(204).end();
});

router.delete('/friends/api/*/friends/:receiverId', verifyToken, async (req, res) => {
  if (!await friendManager.deleteFriend(req.user.accountId, req.params.receiverId)) return res.status(403).end();
  res.status(204).end();
});

router.post('/friends/api/*/blocklist/:receiverId', verifyToken, async (req, res) => {
  const defaultList = { accepted: [], incoming: [], outgoing: [], blocked: [] };
  await Friends.findOneAndUpdate(
    { accountId: req.params.receiverId },
    { $setOnInsert: { accountId: req.params.receiverId, list: defaultList } },
    { upsert: true, new: true }
  );
  if (!await friendManager.blockFriend(req.user.accountId, req.params.receiverId)) return res.status(403).end();
  res.status(204).end();
});

router.delete('/friends/api/*/blocklist/:receiverId', verifyToken, async (req, res) => {
  const from = await Friends.findOne({ accountId: req.user.accountId });
  if (!from) return res.status(204).end();
  from.list.blocked = from.list.blocked.filter((f: any) => f.accountId !== req.params.receiverId);
  await from.updateOne({ $set: { 'list.blocked': from.list.blocked } });
  res.status(204).end();
});

// ── Party: undelivered notifications count ────────────────────────────────────

router.get('/party/api/v1/Fortnite/user/:accountId/notifications/undelivered/count', verifyToken, (req, res) => {
  const { pings, invites } = partyManager.getUndeliveredCount(req.params.accountId);
  res.json({ pings, invites });
});

// ── Party: user lookup ────────────────────────────────────────────────────────

router.get('/party/api/v1/Fortnite/user/:accountId', verifyToken, async (req, res) => {
  const accountId = req.params.accountId;
  
  console.log(`[PARTY LOOKUP] Looking up party for ${accountId}`);
  
  let party = partyManager.getPartyForMember(accountId);
  
  // Auto-create party if user doesn't have one
  if (!party) {
    console.log(`[PARTY LOOKUP] No party found, creating one for ${accountId}`);
    const User = require('../../models/User').default;
    const user = await User.findOne({ accountId }).lean();
    const displayName = user?.username || accountId;
    
    party = partyManager.createParty(
      accountId,
      {},
      { 'urn:epic:member:dn_s': displayName },
      { 'urn:epic:conn:type_s': 'game', 'urn:epic:conn:platform_s': 'WIN' }
    );
    console.log(`[PARTY LOOKUP] Created party ${party.id} for ${accountId}`);
  } else {
    console.log(`[PARTY LOOKUP] Found existing party ${party.id} for ${accountId}`);
  }
  
  // Collect all invites sent to this user from ANY party
  const allInvites: any[] = [];
  const allParties = partyManager.getAllParties();
  allParties.forEach((p) => {
    const userInvites = p.invites?.filter((i) => i.sent_to === accountId && i.status === 'SENT') || [];
    allInvites.push(...userInvites);
  });
  
  const pings = partyManager.getPingsForUser(accountId);
  
  console.log(`[PARTY LOOKUP] Returning party ${party.id}, ${allInvites.length} invites, ${pings.length} pings`);

  res.json({
    current: [partyManager.serializeParty(party)],
    pending: [],
    invites: allInvites,
    pings,
  });
});

// ── Party: create ─────────────────────────────────────────────────────────────

router.post('/party/api/v1/Fortnite/parties', verifyToken, async (req, res) => {
  // accountId can come from the token or from join_info.connection.id
  const connectionId: string = req.body?.join_info?.connection?.id ?? '';
  const accountId = connectionId
    ? connectionId.split('@prod')[0]
    : req.user.accountId;

  const config = req.body?.config ?? {};
  const meta: Record<string, string> = req.body?.join_info?.meta ?? req.body?.meta ?? {};
  const connectionMeta: Record<string, string> = req.body?.join_info?.connection?.meta ?? {};

  if (!req.body?.join_info?.connection) {
    return res.json({});
  }

  const party = partyManager.createParty(accountId, config, meta, connectionMeta);
  res.status(200).json(partyManager.serializeParty(party));
});

// ── Party: get ────────────────────────────────────────────────────────────────

router.get('/party/api/v1/Fortnite/parties/:partyId', verifyToken, (req, res) => {
  const party = partyManager.getParty(req.params.partyId);
  if (!party) {
    return res.status(404).json({
      errorCode: 'errors.com.epicgames.party.party_not_found',
      errorMessage: 'Party not found',
      numericErrorCode: 51002,
    });
  }
  res.json(partyManager.serializeParty(party));
});

// ── Party: update meta / config ───────────────────────────────────────────────

router.patch('/party/api/v1/Fortnite/parties/:partyId', verifyToken, (req, res) => {
  const party = partyManager.getParty(req.params.partyId);
  if (!party) return res.status(404).end();

  const member = party.members.find((m) => m.account_id === req.user.accountId);
  if (!member) return res.status(403).end();

  const metaUpdates: Record<string, string> = req.body?.meta?.update ?? {};
  const metaDeletions: string[] = req.body?.meta?.delete ?? [];
  const configUpdate = req.body?.config ?? {};

  if (Object.keys(metaUpdates).length > 0 || metaDeletions.length > 0) {
    partyManager.updatePartyMeta(req.params.partyId, metaUpdates, metaDeletions);
  }

  if (Object.keys(configUpdate).length > 0) {
    Object.assign(party.config, configUpdate);
  }

  res.status(204).end();
});

// ── Party: join ───────────────────────────────────────────────────────────────

router.post('/party/api/v1/Fortnite/parties/:partyId/members/:accountId/join', verifyToken, (req, res) => {
  const { partyId, accountId } = req.params;
  
  console.log(`[PARTY JOIN API] Join request: partyId=${partyId}, accountId=${accountId}`);
  console.log(`[PARTY JOIN API] Body:`, JSON.stringify(req.body, null, 2));
  
  // Extract meta and connection from request body per Epic's spec
  const meta: Record<string, string> = req.body?.meta ?? {};
  const connectionMeta: Record<string, string> = req.body?.connection?.meta ?? {};
  const connectionId: string = req.body?.connection?.id ?? `${accountId}@prod.ol.epicgames.com`;
  const yieldLeadership: boolean = req.body?.connection?.yield_leadership ?? false;

  // Already in this party
  const existing = partyManager.getPartyForMember(accountId);
  if (existing?.id === partyId) {
    console.log(`[PARTY JOIN API] Already in party, returning success`);
    return res.json({ status: 'JOINED', party_id: partyId });
  }

  const party = partyManager.getParty(partyId);
  if (!party) {
    console.log(`[PARTY JOIN API] ERROR: Party not found`);
    return res.status(404).json({
      errorCode: 'errors.com.epicgames.social.party.party_not_found',
      errorMessage: `Party [${partyId}] does not exist.`,
      numericErrorCode: 51002,
      originatingService: 'party',
      intent: 'prod'
    });
  }

  console.log(`[PARTY JOIN API] Party found, attempting join...`);
  const success = partyManager.joinParty(partyId, accountId, meta, connectionMeta, connectionId);
  
  if (success) {
    console.log(`[PARTY JOIN API] Join successful!`);
    res.json({ status: 'JOINED', party_id: partyId });
  } else {
    console.log(`[PARTY JOIN API] Join failed!`);
    res.status(403).json({
      errorCode: 'errors.com.epicgames.social.party.party_join_failed',
      errorMessage: 'Failed to join party',
      numericErrorCode: 51003,
      originatingService: 'party',
      intent: 'prod'
    });
  }
});

// ── Party: member meta update ─────────────────────────────────────────────────

router.patch('/party/api/v1/Fortnite/parties/:partyId/members/:accountId/meta', verifyToken, (req, res) => {
  const { partyId, accountId } = req.params;
  if (req.user.accountId !== accountId) return res.status(403).end();

  const meta: Record<string, string> = req.body?.update ?? {};
  const deletedMeta: string[] = req.body?.delete ?? [];

  partyManager.updateMemberMeta(partyId, accountId, meta, deletedMeta);
  res.status(204).end();
});

// ── Party: leave ──────────────────────────────────────────────────────────────

router.delete('/party/api/v1/Fortnite/parties/:partyId/members/:accountId', verifyToken, (req, res) => {
  const { partyId, accountId } = req.params;
  const requesterId = req.user.accountId;

  const party = partyManager.getParty(partyId);
  if (!party) return res.status(204).end();

  const requester = party.members.find((m) => m.account_id === requesterId);
  const isKick = requesterId !== accountId;

  // Only captain can kick others
  if (isKick && requester?.role !== 'CAPTAIN') return res.status(403).end();

  partyManager.leaveParty(accountId, isKick);
  res.status(204).end();
});

// ── Party: promote ────────────────────────────────────────────────────────────

router.post('/party/api/v1/Fortnite/parties/:partyId/members/:accountId/promote', verifyToken, (req, res) => {
  const { partyId, accountId } = req.params;
  if (!partyManager.promoteMember(partyId, req.user.accountId, accountId)) return res.status(403).end();
  res.status(204).end();
});

// ── Party: delete ─────────────────────────────────────────────────────────────

router.delete('/party/api/v1/Fortnite/parties/:partyId', verifyToken, (req, res) => {
  partyManager.deleteParty(req.params.partyId);
  res.status(204).end();
});

// ── Party: invites ────────────────────────────────────────────────────────────

router.post('/party/api/v1/Fortnite/parties/:partyId/invites/:accountId', verifyToken, (req, res) => {
  const { partyId, accountId } = req.params;
  const sendPing = req.query.sendPing === 'true';
  
  console.log(`[PARTY INVITE API] Sending invite from party ${partyId} to ${accountId}, sendPing=${sendPing}`);
  
  // Extract meta fields per Epic's spec
  const meta: Record<string, string> = {
    'urn:epic:cfg:build-id_s': req.body?.['urn:epic:cfg:build-id_s'] ?? '1:3:',
    'urn:epic:conn:platform_s': req.body?.['urn:epic:conn:platform_s'] ?? 'WIN',
    'urn:epic:conn:type_s': req.body?.['urn:epic:conn:type_s'] ?? 'game',
    'urn:epic:invite:platformdata_s': req.body?.['urn:epic:invite:platformdata_s'] ?? '',
    'urn:epic:member:dn_s': req.body?.['urn:epic:member:dn_s'] ?? req.user.accountId,
  };

  const invite = partyManager.sendInvite(partyId, req.user.accountId, accountId, meta);
  if (!invite) {
    console.log(`[PARTY INVITE API] Failed to send invite`);
    return res.status(403).json({
      errorCode: 'errors.com.epicgames.social.party.party_not_found',
      errorMessage: 'Party not found or you are not a member',
      numericErrorCode: 51002,
      originatingService: 'party',
      intent: 'prod'
    });
  }

  // Optionally also send a ping
  if (sendPing) {
    console.log(`[PARTY INVITE API] Also sending ping`);
    partyManager.sendPing(req.user.accountId, accountId, meta);
  }

  console.log(`[PARTY INVITE API] Invite sent successfully`);
  res.status(204).end();
});

// Accept invite endpoint
router.post('/party/api/v1/Fortnite/parties/:partyId/invites/:accountId/accept', verifyToken, (req, res) => {
  const { partyId, accountId } = req.params;
  const meta: Record<string, string> = req.body?.meta ?? {};
  const connectionMeta: Record<string, string> = req.body?.connection?.meta ?? {};
  const connectionId: string = req.body?.connection?.id ?? `${accountId}@prod.ol.epicgames.com`;

  const party = partyManager.getParty(partyId);
  if (!party) {
    return res.status(404).json({
      errorCode: 'errors.com.epicgames.social.party.party_not_found',
      errorMessage: 'Party not found',
      numericErrorCode: 51002,
    });
  }

  // Join the party
  const success = partyManager.joinParty(partyId, accountId, meta, connectionMeta, connectionId);
  
  if (success) {
    res.json({ status: 'JOINED', party_id: partyId });
  } else {
    res.status(403).json({
      errorCode: 'errors.com.epicgames.social.party.party_join_failed',
      errorMessage: 'Failed to join party',
      numericErrorCode: 51003,
    });
  }
});

router.delete('/party/api/v1/Fortnite/parties/:partyId/invites/:accountId', verifyToken, (req, res) => {
  partyManager.cancelInvite(req.params.partyId, req.params.accountId);
  res.status(204).end();
});

// Decline invite (various URL patterns the client uses)
router.post([
  '/party/api/v1/Fortnite/parties/:partyId/invites/:accountId/decline',
  '/party/api/v1/Fortnite/parties/:partyId/invites/:accountId/*/decline',
], verifyToken, (req, res) => {
  partyManager.declineInvite(req.params.partyId, req.params.accountId);
  res.status(204).end();
});

// ── Party: pings ──────────────────────────────────────────────────────────────

router.post('/party/api/v1/Fortnite/user/:accountId/pings/:pingerId', verifyToken, async (req, res) => {
  const { accountId: recipientId, pingerId } = req.params;
  const meta: Record<string, string> = req.body?.meta ?? {};

  // Try to get the pinger's display name for the XMPP message
  let pingerDn = pingerId;
  try {
    const account = await User.findOne({ accountId: pingerId }).lean();
    if (account) pingerDn = (account as any).username ?? pingerId;
  } catch {}

  const ping = partyManager.addPing(pingerId, recipientId, meta);

  // Send XMPP ping notification manually so we can use the display name
  const clients = (global as any).Clients;
  const client = clients?.find((c: any) => c.accountId === recipientId);
  if (client) {
    const XMLBuilder = require('xmlbuilder');
    const { MakeID } = require('../../core/utils');
    try {
      client.client.send(
        XMLBuilder.create('message')
          .attribute('id', MakeID().replace(/-/gi, '').toUpperCase())
          .attribute('from', 'xmpp-admin@prod.ol.epicgames.com')
          .attribute('xmlns', 'jabber:client')
          .attribute('to', client.jid)
          .element('body', JSON.stringify({
            expires: ping.expires_at,
            meta,
            ns: 'Fortnite',
            pinger_dn: pingerDn,
            pinger_id: pingerId,
            sent: ping.sent_at,
            type: 'com.epicgames.social.party.notification.v0.PING',
          }))
          .up()
          .toString()
      );
    } catch {}
  }

  res.json(ping);
});

router.delete('/party/api/v1/Fortnite/user/:accountId/pings/:pingerId', verifyToken, (req, res) => {
  partyManager.removePing(req.params.pingerId, req.params.accountId);
  res.status(204).end();
});

// Get parties of the pinger (used by client to find which party to join)
router.get('/party/api/v1/Fortnite/user/:accountId/pings/:pingerId/parties', verifyToken, (req, res) => {
  const { pingerId } = req.params;
  const pingerParty = partyManager.getPartyForMember(pingerId);
  res.json(pingerParty ? [partyManager.serializeParty(pingerParty)] : []);
});

// ── Party: join via ping ──────────────────────────────────────────────────────

router.post('/party/api/v1/Fortnite/user/:accountId/pings/:pingerId/join', verifyToken, (req, res) => {
  const { pingerId } = req.params;
  const joiningId = req.user.accountId;
  const meta: Record<string, string> = req.body?.meta ?? {};
  const connectionMeta: Record<string, string> = req.body?.connection?.meta ?? {};
  const connectionId: string = req.body?.connection?.id ?? `${joiningId}@prod.ol.epicgames.com`;

  const pingerParty = partyManager.getPartyForMember(pingerId);
  if (!pingerParty) {
    return res.status(404).json({
      errorCode: 'errors.com.epicgames.party.party_not_found',
      errorMessage: 'Party not found',
      numericErrorCode: 51002,
    });
  }

  // Already in this party
  if (pingerParty.members.find((m) => m.account_id === joiningId)) {
    return res.json({ status: 'JOINED', party_id: pingerParty.id });
  }

  partyManager.joinParty(pingerParty.id, joiningId, meta, connectionMeta, connectionId);
  partyManager.removePing(pingerId, joiningId);

  res.json({ status: 'JOINED', party_id: pingerParty.id });
});

// ── Party: intentions ─────────────────────────────────────────────────────────

router.post('/party/api/v1/Fortnite/members/:accountId/intentions/:senderId', verifyToken, (req, res) => {
  const { accountId: recipientId, senderId } = req.params;

  const senderParty = partyManager.getPartyForMember(senderId);
  if (!senderParty) {
    return res.status(404).json({
      errorCode: 'errors.com.epicgames.party.party_not_found',
      errorMessage: 'Party not found',
      numericErrorCode: 51002,
    });
  }

  const intention = partyManager.addIntention(senderParty.id, senderId, recipientId, req.body ?? {});
  res.json(intention);
});

router.post('/party/api/v1/Fortnite/parties/:partyId/members/:accountId/intentions', verifyToken, (req, res) => {
  const { partyId, accountId } = req.params;
  const party = partyManager.getParty(partyId);
  if (!party) return res.status(404).end();

  // Auto-accept: join the party
  partyManager.joinParty(partyId, accountId);
  res.status(200).json({
    party_id: partyId,
    account_id: accountId,
    sent_at: new Date().toISOString(),
    expires_at: new Date(Date.now() + 60000).toISOString(),
  });
});

router.get('/party/api/v1/Fortnite/parties/:partyId/members/:accountId/intentions/:intentionId', verifyToken, (_req, res) => res.status(204).end());

// ── Party: privacy settings stub ──────────────────────────────────────────────

router.get('/party/api/v1/Fortnite/user/:accountId/settings/privacy', verifyToken, (_req, res) => {
  res.json({ current: [], pending: [], invites: [], pings: [] });
});

// ── Party: catch-all stub ─────────────────────────────────────────────────────

router.all('/party/api/v1/Fortnite/*', (req, res) => {
  console.log(`[PARTY] Unhandled party endpoint: ${req.method} ${req.url}`);
  res.status(204).end();
});

// ── Presence ──────────────────────────────────────────────────────────────────

router.get('/presence/api/v1/_/:accountId/settings/subscriptions', verifyToken, (_req, res) => res.json([]));
router.get('/presence/api/v1/_/:accountId/subscriptions', verifyToken, (_req, res) => res.json([]));
router.get('/presence/api/v1/_/:accountId/last-online', verifyToken, async (req, res) => {
  const friends = await Friends.findOne({ accountId: req.params.accountId }).lean();
  if (!friends) return res.json({});
  const result: Record<string, string> = {};
  friends.list.accepted.forEach((f: any) => {
    result[f.accountId] = f.created;
  });
  res.json(result);
});

router.get('/presence/api/v1/Fortnite/:accountId/subscriptions/nudged', verifyToken, async (req, res) => {
  const friends = await Friends.findOne({ accountId: req.params.accountId }).lean();
  if (!friends) return res.json([]);

  const onlineFriends = friends.list.accepted
    .filter((f: any) => (global as any).Clients?.find((c: any) => c.accountId === f.accountId))
    .map((f: any) => ({
      accountId: f.accountId,
      status: 'online',
      connection: { id: f.accountId, type: 'game', connected: true },
    }));

  res.json(onlineFriends);
});

router.post('/presence/api/v1/Fortnite/:accountId/subscriptions/broadcast', verifyToken, (_req, res) => res.status(204).end());

export default router;
