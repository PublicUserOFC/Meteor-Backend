import { Friends } from '../models/Friends';
import { exchangePresence, queueOrSend } from '../xmpp/xmpp';

// ── XMPP helpers ─────────────────────────────────────────────────────────────

function xmppSendToAccount(accountId: string, body: object) {
  queueOrSend(accountId, body);
}

// ── Friend request ────────────────────────────────────────────────────────────

export async function sendFriendReq(fromId: string, toId: string): Promise<boolean> {
  if (fromId === toId) return false;

  const [sender, receiver] = await Promise.all([
    Friends.findOne({ accountId: fromId }),
    Friends.findOne({ accountId: toId }),
  ]);
  if (!sender || !receiver) return false;

  // Already friends
  if (sender.list.accepted.find((f) => f.accountId === toId)) return false;
  // Already outgoing
  if (sender.list.outgoing.find((f) => f.accountId === toId)) return false;
  // Blocked
  if (sender.list.blocked.find((f) => f.accountId === toId)) return false;
  if (receiver.list.blocked.find((f) => f.accountId === fromId)) return false;

  const now = new Date().toISOString();

  sender.list.outgoing.push({ accountId: toId, created: now });
  receiver.list.incoming.push({ accountId: fromId, created: now });

  await Promise.all([
    sender.updateOne({ $set: { 'list.outgoing': sender.list.outgoing } }),
    receiver.updateOne({ $set: { 'list.incoming': receiver.list.incoming } }),
  ]);

  // Notify receiver via XMPP — send both Friend object AND FRIENDSHIP_REQUEST
  xmppSendToAccount(toId, {
    type: 'com.epicgames.friends.core.apiobjects.Friend',
    payload: {
      accountId: fromId,
      status: 'PENDING',
      direction: 'INBOUND',
      created: now,
      favorite: false,
    },
    timestamp: now,
  });

  xmppSendToAccount(toId, {
    type: 'FRIENDSHIP_REQUEST',
    timestamp: now,
    from: fromId,
    status: 'PENDING',
  });

  // Notify sender
  xmppSendToAccount(fromId, {
    type: 'com.epicgames.friends.core.apiobjects.Friend',
    payload: {
      accountId: toId,
      status: 'PENDING',
      direction: 'OUTBOUND',
      created: now,
      favorite: false,
    },
    timestamp: now,
  });

  return true;
}

// ── Accept friend request ─────────────────────────────────────────────────────

export async function acceptFriendReq(acceptorId: string, requesterId: string): Promise<boolean> {
  const [acceptor, requester] = await Promise.all([
    Friends.findOne({ accountId: acceptorId }),
    Friends.findOne({ accountId: requesterId }),
  ]);
  if (!acceptor || !requester) return false;

  const incomingIdx = acceptor.list.incoming.findIndex((f) => f.accountId === requesterId);
  if (incomingIdx === -1) return false;

  const outgoingIdx = requester.list.outgoing.findIndex((f) => f.accountId === acceptorId);

  const now = new Date().toISOString();

  // Move from pending → accepted on both sides
  acceptor.list.incoming.splice(incomingIdx, 1);
  if (outgoingIdx !== -1) requester.list.outgoing.splice(outgoingIdx, 1);

  acceptor.list.accepted.push({ accountId: requesterId, created: now });
  requester.list.accepted.push({ accountId: acceptorId, created: now });

  await Promise.all([
    acceptor.updateOne({
      $set: {
        'list.incoming': acceptor.list.incoming,
        'list.accepted': acceptor.list.accepted,
      },
    }),
    requester.updateOne({
      $set: {
        'list.outgoing': requester.list.outgoing,
        'list.accepted': requester.list.accepted,
      },
    }),
  ]);

  // Notify both via XMPP — direction must be correct for each side
  xmppSendToAccount(acceptorId, {
    type: 'com.epicgames.friends.core.apiobjects.Friend',
    payload: {
      accountId: requesterId,
      status: 'ACCEPTED',
      direction: 'INBOUND',
      created: now,
      favorite: false,
    },
    timestamp: now,
  });

  xmppSendToAccount(acceptorId, {
    type: 'FRIENDSHIP_REQUEST',
    timestamp: now,
    from: requesterId,
    status: 'ACCEPTED',
  });

  xmppSendToAccount(requesterId, {
    type: 'com.epicgames.friends.core.apiobjects.Friend',
    payload: {
      accountId: acceptorId,
      status: 'ACCEPTED',
      direction: 'OUTBOUND',
      created: now,
      favorite: false,
    },
    timestamp: now,
  });

  xmppSendToAccount(requesterId, {
    type: 'FRIENDSHIP_REQUEST',
    timestamp: now,
    from: acceptorId,
    status: 'ACCEPTED',
  });

  // Exchange presence after a short delay so the friend notification is processed first
  setTimeout(() => exchangePresence(acceptorId, requesterId), 500);

  return true;
}

// ── Delete / decline friend ───────────────────────────────────────────────────

export async function deleteFriend(fromId: string, toId: string): Promise<boolean> {
  const [from, to] = await Promise.all([
    Friends.findOne({ accountId: fromId }),
    Friends.findOne({ accountId: toId }),
  ]);
  if (!from || !to) return false;

  const removeEntry = (list: any[], id: string) => {
    const idx = list.findIndex((f) => f.accountId === id);
    if (idx !== -1) list.splice(idx, 1);
  };

  removeEntry(from.list.accepted, toId);
  removeEntry(from.list.incoming, toId);
  removeEntry(from.list.outgoing, toId);

  removeEntry(to.list.accepted, fromId);
  removeEntry(to.list.incoming, fromId);
  removeEntry(to.list.outgoing, fromId);

  await Promise.all([
    from.updateOne({ $set: { list: from.list } }),
    to.updateOne({ $set: { list: to.list } }),
  ]);

  const now = new Date().toISOString();

  xmppSendToAccount(fromId, {
    type: 'com.epicgames.friends.core.apiobjects.FriendRemoval',
    payload: { accountId: toId, reason: 'DELETED' },
    timestamp: now,
  });
  xmppSendToAccount(toId, {
    type: 'com.epicgames.friends.core.apiobjects.FriendRemoval',
    payload: { accountId: fromId, reason: 'DELETED' },
    timestamp: now,
  });

  return true;
}

// ── Block ─────────────────────────────────────────────────────────────────────

export async function blockFriend(fromId: string, toId: string): Promise<boolean> {
  await deleteFriend(fromId, toId);

  const from = await Friends.findOne({ accountId: fromId });
  if (!from) return false;

  if (!from.list.blocked.find((f) => f.accountId === toId)) {
    from.list.blocked.push({ accountId: toId, created: new Date().toISOString() });
    await from.updateOne({ $set: { 'list.blocked': from.list.blocked } });
  }

  xmppSendToAccount(fromId, {
    type: 'com.epicgames.friends.core.apiobjects.BlockListEntryAdded',
    payload: { accountId: toId },
    timestamp: new Date().toISOString(),
  });

  return true;
}
