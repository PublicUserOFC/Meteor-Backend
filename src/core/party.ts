import { MakeID } from './utils';

// ── Types ─────────────────────────────────────────────────────────────────────

export interface PartyMember {
  account_id: string;
  meta: Record<string, string>;
  connections: { id: string; meta: Record<string, string>; yield_leadership: boolean; connected_at: string; updated_at: string }[];
  revision: number;
  updated_at: string;
  joined_at: string;
  role: 'CAPTAIN' | 'MEMBER';
}

export interface PartyInvite {
  party_id: string;
  sent_by: string;
  sent_to: string;
  sent_at: string;
  updated_at: string;
  expires_at: string;
  status: 'SENT' | 'ACCEPTED' | 'REJECTED' | 'CANCELLED';
  meta: Record<string, string>;
}

export interface PartyPing {
  sent_by: string;
  sent_to: string;
  sent_at: string;
  expires_at: string;
  meta: Record<string, string>;
}

export interface Party {
  id: string;
  created_at: string;
  updated_at: string;
  config: {
    type: string;
    joinability: string;
    discoverability: string;
    sub_type: string;
    max_size: number;
    invite_ttl: number;
    join_confirmation: boolean;
    intention_ttl: number;
  };
  members: PartyMember[];
  applicants: any[];
  meta: Record<string, string>;
  invites: PartyInvite[];
  revision: number;
  intentions: any[];
}

// ── In-memory store ───────────────────────────────────────────────────────────

// Use global.parties for compatibility
if (!(global as any).parties) {
  (global as any).parties = {};
}

const parties = (global as any).parties;
// accountId → partyId
const memberIndex = new Map<string, string>();
// in-memory pings: pingerId → { recipientId, ping }[]
const pings = new Map<string, PartyPing[]>();

// ── XMPP helper ───────────────────────────────────────────────────────────────

function xmppSend(accountId: string, body: object) {
  const client = (global as any).Clients?.find((c: any) => c.accountId === accountId);
  if (!client) {
    console.log(`[PARTY XMPP] WARNING: No XMPP client found for account ${accountId}`);
    console.log(`[PARTY XMPP] Available clients: ${(global as any).Clients?.length || 0}`);
    return;
  }
  const XMLBuilder = require('xmlbuilder');
  const id = MakeID().replace(/-/gi, '').toUpperCase();
  try {
    client.client.send(
      XMLBuilder.create('message')
        .attribute('id', id)
        .attribute('from', `xmpp-admin@prod.ol.epicgames.com`)
        .attribute('xmlns', 'jabber:client')
        .attribute('to', client.jid)
        .element('body', JSON.stringify(body))
        .up()
        .toString()
    );
    console.log(`[PARTY XMPP] Sent ${(body as any).type} to ${accountId}`);
  } catch (err) {
    console.log(`[PARTY XMPP] ERROR sending to ${accountId}:`, err);
  }
}

function broadcastToParty(party: Party, body: object, excludeId?: string) {
  console.log(`[PARTY BROADCAST] Broadcasting ${(body as any).type} to party ${party.id} (${party.members.length} members, excluding: ${excludeId || 'none'})`);
  party.members.forEach((m) => {
    if (m.account_id !== excludeId) xmppSend(m.account_id, body);
  });
}

function now(): string {
  return new Date().toISOString();
}

// ── Party CRUD ────────────────────────────────────────────────────────────────

export function createParty(
  captainId: string,
  config?: Partial<Party['config']>,
  meta?: Record<string, string>,
  connectionMeta?: Record<string, string>,
): Party {
  // Remove from old party first
  leaveParty(captainId);

  const ts = now();
  const id = MakeID().replace(/-/gi, '');

  const party: Party = {
    id,
    created_at: ts,
    updated_at: ts,
    config: {
      type: 'DEFAULT',
      joinability: 'OPEN',
      discoverability: 'ALL',
      sub_type: 'default',
      max_size: 16,
      invite_ttl: 14400,
      join_confirmation: false,
      intention_ttl: 60,
      ...config,
    },
    members: [{
      account_id: captainId,
      meta: meta ?? {},
      connections: [{
        id: `${captainId}@prod.ol.epicgames.com`,
        connected_at: ts,
        updated_at: ts,
        yield_leadership: false,
        meta: connectionMeta ?? {},
      }],
      revision: 0,
      updated_at: ts,
      joined_at: ts,
      role: 'CAPTAIN',
    }],
    applicants: [],
    meta: {
      'Default:PartyState_s': 'BattleRoyaleView',
      'Default:AllowJoinInProgress_b': 'true',
      'Default:PartyIsJoinedInProgress_b': 'false',
      'Default:PartyMatchmakingInfo_j': JSON.stringify({
        buildId: '1:1:',
        hotfixVersion: 0,
        isARAFill: false,
        playlistName: 'Playlist_DefaultSolo',
        regionId: 'NAE',
        tournamentId: '',
        eventWindowId: '',
        linkCode: '',
      }),
      'Default:RawSquadAssignments_j': JSON.stringify({
        RawSquadAssignments: [{ memberId: captainId, absoluteMemberIdx: 0 }],
      }),
    },
    invites: [],
    revision: 1,
    intentions: [],
  };

  parties[id] = party;
  memberIndex.set(captainId, id);

  return party;
}

export function getParty(partyId: string): Party | undefined {
  return parties[partyId];
}

export function getPartyForMember(accountId: string): Party | undefined {
  const partyId = memberIndex.get(accountId);
  if (!partyId) return undefined;
  return parties[partyId];
}

export function updatePartyMeta(
  partyId: string,
  newMeta: Record<string, string>,
  deletedMeta: string[] = [],
): boolean {
  const party = parties[partyId];
  if (!party) return false;

  Object.assign(party.meta, newMeta);
  deletedMeta.forEach((k) => delete party.meta[k]);
  party.updated_at = now();
  party.revision++;

  const captain = party.members.find((m) => m.role === 'CAPTAIN');
  broadcastToParty(party, {
    captain_id: captain?.account_id ?? '',
    created_at: party.created_at,
    invite_ttl_seconds: party.config.invite_ttl,
    max_number_of_members: party.config.max_size,
    ns: 'Fortnite',
    party_id: partyId,
    party_privacy_type: party.config.joinability,
    party_state_overriden: {},
    party_state_removed: deletedMeta,
    party_state_updated: newMeta,
    party_sub_type: party.meta['urn:epic:cfg:party-type-id_s'] ?? '',
    party_type: 'DEFAULT',
    revision: party.revision,
    sent: now(),
    type: 'com.epicgames.social.party.notification.v0.PARTY_UPDATED',
    updated_at: party.updated_at,
  });

  return true;
}

export function updateMemberMeta(
  partyId: string,
  accountId: string,
  newMeta: Record<string, string>,
  deletedMeta: string[] = [],
): boolean {
  const party = parties[partyId];
  if (!party) return false;

  const member = party.members.find((m) => m.account_id === accountId);
  if (!member) return false;

  Object.assign(member.meta, newMeta);
  deletedMeta.forEach((k) => delete member.meta[k]);
  member.updated_at = now();
  member.revision++;
  party.updated_at = member.updated_at;
  party.revision++;

  broadcastToParty(party, {
    account_id: accountId,
    account_dn: member.meta['urn:epic:member:dn_s'] ?? accountId,
    member_state_updated: newMeta,
    member_state_removed: deletedMeta,
    member_state_overridden: {},
    party_id: partyId,
    updated_at: member.updated_at,
    sent: now(),
    revision: member.revision,
    ns: 'Fortnite',
    type: 'com.epicgames.social.party.notification.v0.MEMBER_STATE_UPDATED',
  });

  return true;
}

export function joinParty(
  partyId: string,
  accountId: string,
  meta?: Record<string, string>,
  connectionMeta?: Record<string, string>,
  connectionId?: string,
): boolean {
  console.log(`[PARTY JOIN CORE] joinParty called: partyId=${partyId}, accountId=${accountId}`);
  
  const party = parties[partyId];
  if (!party) {
    console.log(`[PARTY JOIN CORE] ERROR: Party ${partyId} not found`);
    return false;
  }
  
  if (party.members.length >= party.config.max_size) {
    console.log(`[PARTY JOIN CORE] ERROR: Party ${partyId} is full (${party.members.length}/${party.config.max_size})`);
    return false;
  }
  
  if (party.members.find((m) => m.account_id === accountId)) {
    console.log(`[PARTY JOIN CORE] Account ${accountId} already in party ${partyId} - returning true`);
    return true;
  }

  // Leave current party
  console.log(`[PARTY JOIN CORE] Removing ${accountId} from any existing party`);
  leaveParty(accountId);

  const ts = now();
  const member: PartyMember = {
    account_id: accountId,
    meta: meta ?? {},
    connections: [{
      id: connectionId ?? `${accountId}@prod.ol.epicgames.com`,
      connected_at: ts,
      updated_at: ts,
      yield_leadership: false,
      meta: connectionMeta ?? {},
    }],
    revision: 0,
    updated_at: ts,
    joined_at: ts,
    role: 'MEMBER',
  };

  party.members.push(member);
  party.updated_at = ts;
  party.revision++;
  memberIndex.set(accountId, partyId);
  
  console.log(`[PARTY JOIN CORE] Account ${accountId} added to party ${partyId}, now ${party.members.length} members`);

  // Update RawSquadAssignments
  const rsaKey = party.meta['Default:RawSquadAssignments_j'] !== undefined
    ? 'Default:RawSquadAssignments_j'
    : 'RawSquadAssignments_j';
  let rsa: any = null;
  if (party.meta[rsaKey]) {
    try {
      rsa = JSON.parse(party.meta[rsaKey]);
      rsa.RawSquadAssignments.push({
        memberId: accountId,
        absoluteMemberIdx: party.members.length - 1,
      });
      party.meta[rsaKey] = JSON.stringify(rsa);
    } catch { rsa = null; }
  }

  const captain = party.members.find((m) => m.role === 'CAPTAIN') ?? party.members[0];

  // Notify all members of the join
  console.log(`[PARTY JOIN CORE] Broadcasting MEMBER_JOINED to ${party.members.length} members`);
  broadcastToParty(party, {
    account_dn: meta?.['urn:epic:member:dn_s'] ?? connectionMeta?.['urn:epic:member:dn_s'] ?? accountId,
    account_id: accountId,
    connection: {
      connected_at: ts,
      id: connectionId ?? `${accountId}@prod.ol.epicgames.com`,
      meta: connectionMeta ?? {},
      updated_at: ts,
    },
    joined_at: ts,
    member_state_updated: meta ?? {},
    ns: 'Fortnite',
    party_id: partyId,
    revision: 0,
    sent: ts,
    type: 'com.epicgames.social.party.notification.v0.MEMBER_JOINED',
    updated_at: ts,
  });

  // Broadcast updated squad assignments
  if (rsa) {
    console.log(`[PARTY JOIN CORE] Broadcasting PARTY_UPDATED with squad assignments`);
    broadcastToParty(party, {
      captain_id: captain.account_id,
      created_at: party.created_at,
      invite_ttl_seconds: party.config.invite_ttl,
      max_number_of_members: party.config.max_size,
      ns: 'Fortnite',
      party_id: partyId,
      party_privacy_type: party.config.joinability,
      party_state_overriden: {},
      party_state_removed: [],
      party_state_updated: { [rsaKey]: JSON.stringify(rsa) },
      party_sub_type: party.meta['urn:epic:cfg:party-type-id_s'] ?? '',
      party_type: 'DEFAULT',
      revision: party.revision,
      sent: ts,
      type: 'com.epicgames.social.party.notification.v0.PARTY_UPDATED',
      updated_at: ts,
    });
  }

  console.log(`[PARTY JOIN CORE] joinParty completed successfully`);
  return true;
}

export function leaveParty(accountId: string, wasKicked = false): boolean {
  const partyId = memberIndex.get(accountId);
  if (!partyId) return false;

  const party = parties[partyId];
  if (!party) { memberIndex.delete(accountId); return false; }

  const memberIdx = party.members.findIndex((m) => m.account_id === accountId);
  if (memberIdx === -1) { memberIndex.delete(accountId); return false; }

  party.members.splice(memberIdx, 1);
  memberIndex.delete(accountId);
  party.updated_at = now();
  party.revision++;

  const ts = party.updated_at;

  // Notify all remaining members + the leaving member
  const leftMsg = {
    account_id: accountId,
    member_state_update: {},
    ns: 'Fortnite',
    party_id: partyId,
    revision: party.revision,
    sent: ts,
    type: 'com.epicgames.social.party.notification.v0.MEMBER_LEFT',
  };

  broadcastToParty(party, leftMsg);
  xmppSend(accountId, leftMsg);

  // If party is empty, delete it
  if (party.members.length === 0) {
    delete parties[partyId];
    return true;
  }

  // Update RawSquadAssignments after leave
  const rsaKey = party.meta['Default:RawSquadAssignments_j'] !== undefined
    ? 'Default:RawSquadAssignments_j'
    : 'RawSquadAssignments_j';
  let rsa: any = null;
  if (party.meta[rsaKey]) {
    try {
      rsa = JSON.parse(party.meta[rsaKey]);
      const idx = rsa.RawSquadAssignments.findIndex((a: any) => a.memberId === accountId);
      if (idx !== -1) rsa.RawSquadAssignments.splice(idx, 1);
      party.meta[rsaKey] = JSON.stringify(rsa);
    } catch { rsa = null; }
  }

  // If captain left, promote next member
  const hasCaptain = party.members.some((m) => m.role === 'CAPTAIN');
  if (!hasCaptain && party.members.length > 0) {
    party.members[0].role = 'CAPTAIN';
    broadcastToParty(party, {
      account_id: party.members[0].account_id,
      member_state_update: {},
      ns: 'Fortnite',
      party_id: partyId,
      revision: party.revision,
      sent: ts,
      type: 'com.epicgames.social.party.notification.v0.MEMBER_NEW_CAPTAIN',
    });
  }

  // Broadcast updated squad assignments
  const captain = party.members.find((m) => m.role === 'CAPTAIN') ?? party.members[0];
  if (captain && rsa) {
    broadcastToParty(party, {
      captain_id: captain.account_id,
      created_at: party.created_at,
      invite_ttl_seconds: party.config.invite_ttl,
      max_number_of_members: party.config.max_size,
      ns: 'Fortnite',
      party_id: partyId,
      party_privacy_type: party.config.joinability,
      party_state_overriden: {},
      party_state_removed: [],
      party_state_updated: rsa ? { [rsaKey]: JSON.stringify(rsa) } : {},
      party_sub_type: party.meta['urn:epic:cfg:party-type-id_s'] ?? '',
      party_type: 'DEFAULT',
      revision: party.revision,
      sent: ts,
      type: 'com.epicgames.social.party.notification.v0.PARTY_UPDATED',
      updated_at: ts,
    });
  }

  return true;
}

export function promoteMember(partyId: string, captainId: string, targetId: string): boolean {
  const party = parties[partyId];
  if (!party) return false;

  const captain = party.members.find((m) => m.account_id === captainId);
  if (!captain || captain.role !== 'CAPTAIN') return false;

  const target = party.members.find((m) => m.account_id === targetId);
  if (!target) return false;

  captain.role = 'MEMBER';
  target.role = 'CAPTAIN';
  party.updated_at = now();
  party.revision++;

  broadcastToParty(party, {
    account_id: targetId,
    member_state_update: {},
    ns: 'Fortnite',
    party_id: partyId,
    revision: party.revision,
    sent: now(),
    type: 'com.epicgames.social.party.notification.v0.MEMBER_NEW_CAPTAIN',
  });

  return true;
}

export function deleteParty(partyId: string): void {
  const party = parties[partyId];
  if (!party) return;
  party.members.forEach((m) => memberIndex.delete(m.account_id));
  delete parties[partyId];
}

// ── Invites ───────────────────────────────────────────────────────────────────

export function sendInvite(
  partyId: string,
  fromId: string,
  toId: string,
  meta?: Record<string, string>,
): PartyInvite | null {
  const party = parties[partyId];
  if (!party) return null;

  const sender = party.members.find((m) => m.account_id === fromId);
  if (!sender) return null;

  // Check if invite already exists
  const existingInvite = party.invites.find((i) => i.sent_to === toId && i.status === 'SENT');
  if (existingInvite) {
    // Return existing invite instead of creating duplicate
    return existingInvite;
  }

  const ts = now();
  const expires = new Date(Date.now() + party.config.invite_ttl * 1000).toISOString();

  const invite: PartyInvite = {
    party_id: partyId,
    sent_by: fromId,
    sent_to: toId,
    sent_at: ts,
    updated_at: ts,
    expires_at: expires,
    status: 'SENT',
    meta: meta ?? {
      'urn:epic:conn:type_s': 'game',
      'urn:epic:invite:platformdata_s': '',
    },
  };

  party.invites.push(invite);

  // Send invite notification
  xmppSend(toId, {
    expires: expires,
    meta: invite.meta,
    ns: 'Fortnite',
    party_id: partyId,
    inviter_dn: sender.meta['urn:epic:member:dn_s'] ?? fromId,
    inviter_id: fromId,
    invitee_id: toId,
    members_count: party.members.length,
    sent_at: ts,
    updated_at: ts,
    sent: ts,
    type: 'com.epicgames.social.party.notification.v0.INITIAL_INVITE',
  });

  return invite;
}

export function cancelInvite(partyId: string, toId: string): boolean {
  const party = parties[partyId];
  if (!party) return false;

  const idx = party.invites.findIndex((i) => i.sent_to === toId);
  if (idx === -1) return false;

  const invite = party.invites[idx];
  party.invites.splice(idx, 1);

  const inviter = party.members.find((m) => m.account_id === invite.sent_by);
  if (inviter) {
    xmppSend(invite.sent_by, {
      expires: invite.expires_at,
      meta: invite.meta,
      ns: 'Fortnite',
      party_id: partyId,
      inviter_dn: inviter.meta['urn:epic:member:dn_s'] ?? invite.sent_by,
      inviter_id: invite.sent_by,
      invitee_id: toId,
      sent_at: invite.sent_at,
      updated_at: invite.updated_at,
      sent: now(),
      type: 'com.epicgames.social.party.notification.v0.INVITE_CANCELLED',
    });
  }

  return true;
}

export function declineInvite(partyId: string, toId: string): boolean {
  const party = parties[partyId];
  if (!party) return false;

  const idx = party.invites.findIndex((i) => i.sent_to === toId);
  if (idx === -1) return false;

  const invite = party.invites[idx];
  party.invites.splice(idx, 1);

  const inviter = party.members.find((m) => m.account_id === invite.sent_by);
  if (inviter) {
    xmppSend(invite.sent_by, {
      expires: invite.expires_at,
      meta: {},
      ns: 'Fortnite',
      party_id: partyId,
      inviter_dn: inviter.meta['urn:epic:member:dn_s'] ?? invite.sent_by,
      inviter_id: invite.sent_by,
      invitee_id: toId,
      sent_at: invite.sent_at,
      updated_at: invite.updated_at,
      sent: now(),
      type: 'com.epicgames.social.party.notification.v0.INVITE_DECLINED',
    });
  }

  return true;
}

// ── Pings ─────────────────────────────────────────────────────────────────────

export function addPing(
  fromId: string,
  toId: string,
  meta?: Record<string, string>,
): PartyPing {
  const ts = now();
  const ping: PartyPing = {
    sent_by: fromId,
    sent_to: toId,
    sent_at: ts,
    expires_at: new Date(Date.now() + 14400 * 1000).toISOString(),
    meta: meta ?? {},
  };

  const existing = pings.get(fromId) ?? [];
  // Remove any existing ping to same recipient
  const filtered = existing.filter((p) => p.sent_to !== toId);
  filtered.push(ping);
  pings.set(fromId, filtered);

  return ping;
}

export function removePing(fromId: string, toId: string): void {
  const existing = pings.get(fromId);
  if (!existing) return;
  pings.set(fromId, existing.filter((p) => p.sent_to !== toId));
}

export function getPingsForUser(toId: string): PartyPing[] {
  const result: PartyPing[] = [];
  pings.forEach((list) => {
    list.forEach((p) => {
      if (p.sent_to === toId) result.push(p);
    });
  });
  return result;
}

export function sendPing(fromId: string, toId: string, meta?: Record<string, string>): PartyPing {
  const ping = addPing(fromId, toId, meta);

  xmppSend(toId, {
    expires: ping.expires_at,
    meta: ping.meta,
    ns: 'Fortnite',
    pinger_dn: fromId,
    pinger_id: fromId,
    sent: ping.sent_at,
    type: 'com.epicgames.social.party.notification.v0.PING',
  });

  return ping;
}

export function getUndeliveredCount(accountId: string): { pings: number; invites: number } {
  const userPings = getPingsForUser(accountId).length;
  let inviteCount = 0;
  
  // parties is an object, not an array - iterate over its values
  Object.values(parties).forEach((p: any) => {
    if (p && p.invites && Array.isArray(p.invites)) {
      inviteCount += p.invites.filter((i: any) => i.sent_to === accountId && i.status === 'SENT').length;
    }
  });
  
  return { pings: userPings, invites: inviteCount };
}

// ── Intentions ────────────────────────────────────────────────────────────────

export function addIntention(
  partyId: string,
  senderId: string,
  recipientId: string,
  meta?: Record<string, string>,
): { party_id: string; account_id: string; sent_at: string; expires_at: string } {
  const ts = now();
  const expires = new Date(Date.now() + 60 * 1000).toISOString();

  const party = parties[partyId];
  if (party) {
    const sender = party.members.find((m) => m.account_id === senderId);
    const captain = party.members.find((m) => m.role === 'CAPTAIN');

    xmppSend(recipientId, {
      expires_at: expires,
      requester_id: senderId,
      requester_dn: sender?.meta['urn:epic:member:dn_s'] ?? senderId,
      requester_pl: captain?.account_id ?? senderId,
      requester_pl_dn: captain?.meta['urn:epic:member:dn_s'] ?? senderId,
      requestee_id: recipientId,
      meta: meta ?? {},
      sent_at: ts,
      updated_at: ts,
      friends_ids: [],
      members_count: party.members.length,
      party_id: partyId,
      ns: 'Fortnite',
      sent: ts,
      type: 'com.epicgames.social.party.notification.v0.INITIAL_INTENTION',
    });
  }

  return { party_id: partyId, account_id: senderId, sent_at: ts, expires_at: expires };
}

// ── Serialization ─────────────────────────────────────────────────────────────

export function getAllParties(): Party[] {
  return Object.values(parties);
}

export function serializeParty(party: Party) {
  return {
    id: party.id,
    created_at: party.created_at,
    updated_at: party.updated_at,
    config: party.config,
    members: party.members.map((m) => ({
      account_id: m.account_id,
      meta: m.meta,
      connections: m.connections,
      revision: m.revision,
      updated_at: m.updated_at,
      joined_at: m.joined_at,
      role: m.role,
    })),
    applicants: party.applicants,
    meta: party.meta,
    invites: party.invites,
    revision: party.revision,
    intentions: party.intentions,
  };
}
