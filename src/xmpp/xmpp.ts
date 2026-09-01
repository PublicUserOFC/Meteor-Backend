import { Server as WebSocketServer, WebSocket } from 'ws';
import XMLBuilder from 'xmlbuilder';
import XMLParser from 'xml-parser';
import express, { Request, Response } from 'express';
import https from 'https';
import fs from 'fs';
import { config } from '../config';
import { xmpp as log } from '../core/logger';
import { MakeID, DecodeBase64 } from '../core/utils';
import { User } from '../models/User';
import { Friends } from '../models/Friends';
import { filterChatMessage } from '../utils/profanityFilter';

const app = express();

interface XMPPClient {
  client: WebSocket;
  accountId: string;
  displayName: string;
  token: string;
  jid: string;
  resource: string;
  lastPresenceUpdate: {
    away: boolean;
    status: string;
  };
}

interface MUCMember {
  accountId: string;
}

interface MUC {
  members: MUCMember[];
}

declare global {
  var xmppDomain: string;
  var Clients: XMPPClient[];
  var MUCs: { [key: string]: MUC };
  var accessTokens: Array<{ token: string; accountId: string }>;
}

global.xmppDomain = 'prod.ol.epicgames.com';
global.Clients = [];
global.MUCs = {};

// Pending messages for clients not yet connected — delivered on session start
// Store raw body objects, build XML when we have the JID
const pendingMessages = new Map<string, object[]>();

function queueOrSend(accountId: string, body: object) {
  const client = global.Clients.find((c) => c.accountId === accountId);
  if (client) {
    try {
      const xml = XMLBuilder.create('message')
        .attribute('id', MakeID().replace(/-/gi, '').toUpperCase())
        .attribute('from', `xmpp-admin@prod.ol.epicgames.com`)
        .attribute('xmlns', 'jabber:client')
        .attribute('to', client.jid)
        .element('body', JSON.stringify(body))
        .up()
        .toString();
      client.client.send(xml);
      log(`[XMPP] Sent message to online user ${accountId}`);
    } catch (err) {
      log(`[XMPP] Error sending message to ${accountId}: ${err}`);
    }
    return;
  }
  const queue = pendingMessages.get(accountId) ?? [];
  queue.push(body);
  pendingMessages.set(accountId, queue);
  log(`[XMPP] Queued message for offline user ${accountId} (queue size: ${queue.length})`);
}

function flushPending(accountId: string, ws: WebSocket, jid: string) {
  const queue = pendingMessages.get(accountId);
  if (!queue || queue.length === 0) return;
  pendingMessages.delete(accountId);
  for (const body of queue) {
    try {
      const xml = XMLBuilder.create('message')
        .attribute('id', MakeID().replace(/-/gi, '').toUpperCase())
        .attribute('from', `xmpp-admin@prod.ol.epicgames.com`)
        .attribute('xmlns', 'jabber:client')
        .attribute('to', jid)
        .element('body', JSON.stringify(body))
        .up()
        .toString();
      ws.send(xml);
      log(`[XMPP] Flushed pending message to ${accountId}`);
    } catch (err) {
      log(`[XMPP] Error flushing message to ${accountId}: ${err}`);
    }
  }
}

const port = 80; // XMPP server port (standard XMPP WebSocket port)

app.get('/', (_req: Request, res: Response) => {
  res.type('application/json');
  res.header('Access-Control-Allow-Origin', '*');

  const data = JSON.stringify(
    {
      Clients: {
        amount: global.Clients.length,
        clients: global.Clients.map((i) => i.displayName),
      },
    },
    null,
    2
  );

  res.send(data);
});

app.get('/clients', (_req: Request, res: Response) => {
  res.type('application/json');

  const data = JSON.stringify(
    {
      amount: global.Clients.length,
      clients: global.Clients.map((i) => i.displayName),
    },
    null,
    2
  );

  res.send(data);
});

let wss: WebSocketServer;

const server = app.listen(port, () => {
  log(`XMPP started listening on port ${port}`);
}).on('error', (err: any) => {
  if (err.code === 'EACCES') {
    console.error(`\n❌ ERROR: Port ${port} requires administrator privileges!`);
    console.error(`Please run the backend as Administrator or change XMPP port in xmpp.ts\n`);
  } else if (err.code === 'EADDRINUSE') {
    console.error(`\n❌ ERROR: Port ${port} is already in use!`);
    console.error(`Another process is using port ${port}. Stop it or change the XMPP port.\n`);
  } else {
    console.error(`\n❌ XMPP Server Error:`, err);
  }
  process.exit(1);
});

wss = new WebSocketServer({ server });

import { handleMatchmaking } from '../matchmaker/matchmaker';

wss.on('connection', async (ws: WebSocket, req: any) => {
  log(`[XMPP] New WebSocket connection attempt from ${req.socket.remoteAddress}`);
  log(`[XMPP] Protocol: ${req.headers['sec-websocket-protocol']}`);
  log(`[XMPP] URL: ${req.url}`);
  
  ws.on('error', (err) => {
    log(`[XMPP] WebSocket error: ${err.message}`);
  });

  // Check if this is a matchmaker connection (has playlist in URL)
  const urlParams = new URLSearchParams(req.url?.split('?')[1] || '');
  const hasPlaylist = urlParams.has('playlist') || urlParams.has('bucketId');
  
  // Route to matchmaker if it has playlist params OR explicitly not XMPP protocol
  const protocol = req.headers['sec-websocket-protocol']?.toLowerCase();
  if (hasPlaylist || (protocol && protocol !== 'xmpp')) {
    log(`[XMPP] Non-XMPP connection detected (protocol: ${protocol}, hasPlaylist: ${hasPlaylist}), routing to matchmaker`);
    const playlist = urlParams.get('playlist') || urlParams.get('bucketId')?.split(':')?.[3] || undefined;
    handleMatchmaking(ws, playlist);
    return;
  }

  log(`[XMPP] Accepting XMPP connection (protocol: ${protocol || 'none'})`);

  let joinedMUCs: string[] = [];
  let accountId = '';
  let displayName = '';
  let token = '';
  let jid = '';
  let resource = '';
  let ID = '';
  let Authenticated = false;
  let clientExists = false;
  let connectionClosed = false;

  ws.on('message', async (message: Buffer | string) => {
    if (Buffer.isBuffer(message)) message = message.toString();

    const msg = XMLParser(message);
    if (!msg || !msg.root || !msg.root.name) return sendError(ws);

    switch (msg.root.name) {
      case 'open':
        if (!ID) ID = MakeID();

        ws.send(
          XMLBuilder.create('open')
            .attribute('xmlns', 'urn:ietf:params:xml:ns:xmpp-framing')
            .attribute('from', global.xmppDomain)
            .attribute('id', ID)
            .attribute('version', '1.0')
            .attribute('xml:lang', 'en')
            .toString()
        );

        if (Authenticated) {
          ws.send(
            XMLBuilder.create('stream:features')
              .attribute('xmlns:stream', 'http://etherx.jabber.org/streams')
              .element('ver')
              .attribute('xmlns', 'urn:xmpp:features:rosterver')
              .up()
              .element('starttls')
              .attribute('xmlns', 'urn:ietf:params:xml:ns:xmpp-tls')
              .up()
              .element('bind')
              .attribute('xmlns', 'urn:ietf:params:xml:ns:xmpp-bind')
              .up()
              .element('compression')
              .attribute('xmlns', 'http://jabber.org/features/compress')
              .element('method', 'zlib')
              .up()
              .up()
              .element('session')
              .attribute('xmlns', 'urn:ietf:params:xml:ns:xmpp-session')
              .up()
              .toString()
          );
        } else {
          ws.send(
            XMLBuilder.create('stream:features')
              .attribute('xmlns:stream', 'http://etherx.jabber.org/streams')
              .element('mechanisms')
              .attribute('xmlns', 'urn:ietf:params:xml:ns:xmpp-sasl')
              .element('mechanism', 'PLAIN')
              .up()
              .up()
              .element('ver')
              .attribute('xmlns', 'urn:xmpp:features:rosterver')
              .up()
              .element('starttls')
              .attribute('xmlns', 'urn:ietf:params:xml:ns:xmpp-tls')
              .up()
              .element('compression')
              .attribute('xmlns', 'http://jabber.org/features/compress')
              .element('method', 'zlib')
              .up()
              .up()
              .element('auth')
              .attribute('xmlns', 'http://jabber.org/features/iq-auth')
              .up()
              .toString()
          );
        }
        break;

      case 'auth':
        if (!ID) return;
        if (accountId) return;
        if (!msg.root.content) {
          log(`[XMPP] Auth failed: no content in auth message`);
          return sendError(ws);
        }
        if (!DecodeBase64(msg.root.content).includes('\u0000')) {
          log(`[XMPP] Auth failed: decoded content doesn't contain null separator`);
          return sendError(ws);
        }

        const decodedBase64 = DecodeBase64(msg.root.content).split('\u0000');
        log(`[XMPP] Auth attempt - decoded parts: ${decodedBase64.length}, token: ${decodedBase64[2]?.substring(0, 20)}...`);
        log(`[XMPP] Available tokens in global.accessTokens: ${global.accessTokens.length}`);

        // Strip eg1~ prefix if present
        const clientToken = decodedBase64[2]?.replace(/^eg1~/i, '') || '';
        
        const object = global.accessTokens.find((i) => i.token == clientToken);
        if (!object) {
          log(`[XMPP] Auth failed: token not found in global.accessTokens`);
          log(`[XMPP] Looking for token (stripped): ${clientToken?.substring(0, 30)}...`);
          if (global.accessTokens.length > 0) {
            log(`[XMPP] First token in array: ${global.accessTokens[0].token.substring(0, 30)}...`);
          }
          return sendError(ws);
        }

        // Replace existing connection for same account instead of rejecting
        const existingIdx = global.Clients.findIndex((i) => i.accountId == object.accountId);
        if (existingIdx !== -1) {
          try { global.Clients[existingIdx].client.close(); } catch {}
          global.Clients.splice(existingIdx, 1);
        }

        const user = await User.findOne({ accountId: object.accountId, banned: false }).lean();
        if (!user) return sendError(ws);

        accountId = user.accountId;
        displayName = user.username;
        token = object.token;

        if (decodedBase64 && accountId && displayName && token && decodedBase64.length == 3) {
          Authenticated = true;
          log(`An xmpp client with the displayName ${displayName} has logged in.`);

          ws.send(
            XMLBuilder.create('success')
              .attribute('xmlns', 'urn:ietf:params:xml:ns:xmpp-sasl')
              .toString()
          );
        } else return sendError(ws);
        break;

      case 'iq':
        if (!ID) return;

        switch (msg.root.attributes.id) {
          case '_xmpp_bind1':
            if (resource || !accountId) return;
            if (!msg.root.children.find((i: any) => i.name == 'bind')) return;

            if (global.Clients.find((i) => i.accountId == accountId)) return sendError(ws);

            const findResource = msg.root.children
              .find((i: any) => i.name == 'bind')
              .children.find((i: any) => i.name == 'resource');

            if (!findResource) return;
            if (!findResource.content) return;

            resource = findResource.content;
            jid = `${accountId}@${global.xmppDomain}/${resource}`;

            ws.send(
              XMLBuilder.create('iq')
                .attribute('to', jid)
                .attribute('id', '_xmpp_bind1')
                .attribute('xmlns', 'jabber:client')
                .attribute('type', 'result')
                .element('bind')
                .attribute('xmlns', 'urn:ietf:params:xml:ns:xmpp-bind')
                .element('jid', jid)
                .up()
                .up()
                .toString()
            );
            break;

          case '_xmpp_session1':
            if (!clientExists) return sendError(ws);

            ws.send(
              XMLBuilder.create('iq')
                .attribute('to', jid)
                .attribute('from', global.xmppDomain)
                .attribute('id', '_xmpp_session1')
                .attribute('xmlns', 'jabber:client')
                .attribute('type', 'result')
                .toString()
            );

            // Flush any messages that were sent before this client connected
            flushPending(accountId, ws, jid);
            // Ensure Friends document exists for this account
            await Friends.findOneAndUpdate(
              { accountId },
              { $setOnInsert: { accountId, list: { accepted: [], incoming: [], outgoing: [], blocked: [] } } },
              { upsert: true, new: true }
            );
            log(`[XMPP] Session started for ${accountId}, sending friend presence...`);
            // Send presence of all online friends to this client
            await getPresenceFromFriends(ws, accountId, jid);
            // Broadcast this client as online to all friends with a proper lobby status
            const lobbyStatus = JSON.stringify({
              Status: 'Battle Royale Lobby - 1 / 16',
              bIsPlaying: false,
              bIsJoinable: false,
              bHasVoiceSupport: false,
              SessionId: '',
              Properties: {},
            });
            global.Clients[global.Clients.findIndex(c => c.accountId === accountId)].lastPresenceUpdate.status = lobbyStatus;
            log(`[XMPP] Broadcasting ${accountId} as online to all friends...`);
            await updatePresenceForFriends(ws, lobbyStatus, false, false);
            log(`[XMPP] Session setup complete for ${accountId}`);
            break;

          default:
            if (!clientExists) return sendError(ws);

            ws.send(
              XMLBuilder.create('iq')
                .attribute('to', jid)
                .attribute('from', global.xmppDomain)
                .attribute('id', msg.root.attributes.id)
                .attribute('xmlns', 'jabber:client')
                .attribute('type', 'result')
                .toString()
            );
        }
        break;

      case 'message':
        if (!clientExists) return sendError(ws);

        const findBody = msg.root.children.find((i: any) => i.name == 'body');

        if (!findBody || !findBody.content) return;

        let body = findBody.content;

        // Filter profanity from chat messages
        const filteredBody = filterChatMessage(body, false); // false = censor, true = block entirely
        if (filteredBody === null) {
          // Message was blocked due to profanity
          log(`[XMPP] Blocked message from ${accountId} due to profanity`);
          return;
        }
        body = filteredBody;

        switch (msg.root.attributes.type) {
          case 'chat':
            if (!msg.root.attributes.to) return;
            if (body.length >= 300) return;

            const receiver = global.Clients.find(
              (i) => i.jid.split('/')[0] == msg.root.attributes.to
            );

            if (!receiver) return;
            if (receiver.accountId == accountId) return;

            receiver.client.send(
              XMLBuilder.create('message')
                .attribute('to', receiver.jid)
                .attribute('from', jid)
                .attribute('xmlns', 'jabber:client')
                .attribute('type', 'chat')
                .element('body', body)
                .up()
                .toString()
            );
            return;

          case 'groupchat':
            if (!msg.root.attributes.to) return;
            if (body.length >= 300) return;

            const roomName = msg.root.attributes.to.split('@')[0];

            const MUC = global.MUCs[roomName];
            if (!MUC) return;

            if (!MUC.members.find((i) => i.accountId == accountId)) return;

            MUC.members.forEach((member) => {
              const ClientData = global.Clients.find((i) => i.accountId == member.accountId);
              if (!ClientData) return;

              ClientData.client.send(
                XMLBuilder.create('message')
                  .attribute('to', ClientData.jid)
                  .attribute('from', getMUCmember(roomName, displayName, accountId, resource))
                  .attribute('xmlns', 'jabber:client')
                  .attribute('type', 'groupchat')
                  .element('body', body)
                  .up()
                  .toString()
              );
            });
            return;
        }

        if (isJSON(body)) {
          const bodyJSON = JSON.parse(body);

          if (Array.isArray(bodyJSON)) return;
          if (typeof bodyJSON.type != 'string') return;
          if (!msg.root.attributes.to) return;
          if (!msg.root.attributes.id) return;

          sendXmppMessageToClient(jid, msg, body);
        }
        break;

      case 'presence':
        if (!clientExists) return sendError(ws);

        if (msg.root.attributes.type === 'unavailable') {
          if (
            msg.root.attributes.to &&
            (msg.root.attributes.to.endsWith(`@muc.${global.xmppDomain}`) ||
              msg.root.attributes.to.split('/')[0].endsWith(`@muc.${global.xmppDomain}`))
          ) {
            if (!msg.root.attributes.to.toLowerCase().startsWith('party-')) return;

            const roomName = msg.root.attributes.to.split('@')[0];

            if (!global.MUCs[roomName]) return;

            const memberIndex = global.MUCs[roomName].members.findIndex(
              (i) => i.accountId == accountId
            );
            if (memberIndex != -1) {
              global.MUCs[roomName].members.splice(memberIndex, 1);
              joinedMUCs.splice(joinedMUCs.indexOf(roomName), 1);
            }

            ws.send(
              XMLBuilder.create('presence')
                .attribute('to', jid)
                .attribute('from', getMUCmember(roomName, displayName, accountId, resource))
                .attribute('xmlns', 'jabber:client')
                .attribute('type', 'unavailable')
                .element('x')
                .attribute('xmlns', 'http://jabber.org/protocol/muc#user')
                .element('item')
                .attribute(
                  'nick',
                  getMUCmember(roomName, displayName, accountId, resource).replace(
                    `${roomName}@muc.${global.xmppDomain}/`,
                    ''
                  )
                )
                .attribute('jid', jid)
                .attribute('role', 'none')
                .up()
                .element('status')
                .attribute('code', '110')
                .up()
                .element('status')
                .attribute('code', '100')
                .up()
                .element('status')
                .attribute('code', '170')
                .up()
                .up()
                .toString()
            );
          } else {
            await updatePresenceForFriends(ws, '{}', false, true);
          }
          return;
        }

        if (
          msg.root.children.find((i: any) => i.name == 'muc:x') ||
          msg.root.children.find((i: any) => i.name == 'x')
        ) {
          if (!msg.root.attributes.to) return;

          const roomName = msg.root.attributes.to.split('@')[0];

          if (!global.MUCs[roomName]) global.MUCs[roomName] = { members: [] };

          if (global.MUCs[roomName].members.find((i) => i.accountId == accountId)) return;

          global.MUCs[roomName].members.push({ accountId: accountId });

          joinedMUCs.push(roomName);

          ws.send(
            XMLBuilder.create('presence')
              .attribute('to', jid)
              .attribute('from', getMUCmember(roomName, displayName, accountId, resource))
              .attribute('xmlns', 'jabber:client')
              .element('x')
              .attribute('xmlns', 'http://jabber.org/protocol/muc#user')
              .element('item')
              .attribute(
                'nick',
                getMUCmember(roomName, displayName, accountId, resource).replace(
                  `${roomName}@muc.${global.xmppDomain}/`,
                  ''
                )
              )
              .attribute('jid', jid)
              .attribute('role', 'participant')
              .attribute('affiliation', 'none')
              .up()
              .element('status')
              .attribute('code', '110')
              .up()
              .element('status')
              .attribute('code', '100')
              .up()
              .element('status')
              .attribute('code', '170')
              .up()
              .element('status')
              .attribute('code', '201')
              .up()
              .up()
              .toString()
          );

          global.MUCs[roomName].members.forEach((member) => {
            const ClientData = global.Clients.find((i) => i.accountId == member.accountId);
            if (!ClientData) return;

            ws.send(
              XMLBuilder.create('presence')
                .attribute(
                  'from',
                  getMUCmember(roomName, ClientData.displayName, ClientData.accountId, ClientData.resource)
                )
                .attribute('to', jid)
                .attribute('xmlns', 'jabber:client')
                .element('x')
                .attribute('xmlns', 'http://jabber.org/protocol/muc#user')
                .element('item')
                .attribute(
                  'nick',
                  getMUCmember(
                    roomName,
                    ClientData.displayName,
                    ClientData.accountId,
                    ClientData.resource
                  ).replace(`${roomName}@muc.${global.xmppDomain}/`, '')
                )
                .attribute('jid', ClientData.jid)
                .attribute('role', 'participant')
                .attribute('affiliation', 'none')
                .up()
                .up()
                .toString()
            );

            if (accountId == ClientData.accountId) return;

            ClientData.client.send(
              XMLBuilder.create('presence')
                .attribute('from', getMUCmember(roomName, displayName, accountId, resource))
                .attribute('to', ClientData.jid)
                .attribute('xmlns', 'jabber:client')
                .element('x')
                .attribute('xmlns', 'http://jabber.org/protocol/muc#user')
                .element('item')
                .attribute(
                  'nick',
                  getMUCmember(roomName, displayName, accountId, resource).replace(
                    `${roomName}@muc.${global.xmppDomain}/`,
                    ''
                  )
                )
                .attribute('jid', jid)
                .attribute('role', 'participant')
                .attribute('affiliation', 'none')
                .up()
                .up()
                .toString()
            );
          });
          return;
        }

        const findStatus = msg.root.children.find((i: any) => i.name == 'status');
        let status = findStatus ? findStatus.content : '{}';
        const away = msg.root.children.find((i: any) => i.name == 'show') ? true : false;

        if (status && isJSON(status)) {
          if (Array.isArray(JSON.parse(status))) status = '{}';
        } else {
          status = '{}';
        }

        await updatePresenceForFriends(ws, status, away, false);
        break;
    }

    if (!clientExists && !connectionClosed) {
      if (accountId && displayName && token && jid && ID && resource && Authenticated) {
        global.Clients.push({
          client: ws,
          accountId: accountId,
          displayName: displayName,
          token: token,
          jid: jid,
          resource: resource,
          lastPresenceUpdate: {
            away: false,
            status: JSON.stringify({
              Status: 'Battle Royale Lobby - 1 / 16',
              bIsPlaying: false,
              bIsJoinable: false,
              bHasVoiceSupport: false,
              SessionId: '',
              Properties: {
                'party.joininfodata.286331153_j': JSON.stringify({
                  bIsPrivate: true,
                }),
                'FortBasicInfo_j': JSON.stringify({
                  homeBaseRating: 0,
                }),
                'FortLFG_I': '0',
                'FortPartySize_i': '1',
                'FortSubGame_i': '1',
                'InUnjoinableMatch_b': 'false',
                'FortGameplayStats_j': JSON.stringify({
                  state: '',
                  playlist: 'None',
                  numKills: 0,
                  bFellToDeath: false,
                }),
              },
            }),
          },
        });

        clientExists = true;
      }
    }
  });

  ws.on('close', () => {
    connectionClosed = true;
    clientExists = false;
    RemoveClient(ws, joinedMUCs);
  });
});

function sendError(ws: WebSocket) {
  ws.send(
    XMLBuilder.create('close')
      .attribute('xmlns', 'urn:ietf:params:xml:ns:xmpp-framing')
      .toString()
  );
  ws.close();
}

function RemoveClient(ws: WebSocket, joinedMUCs: string[]) {
  const clientIndex = global.Clients.findIndex((i) => i.client == ws);
  const client = global.Clients[clientIndex];

  if (clientIndex == -1) return;

  const ClientStatus = JSON.parse(client.lastPresenceUpdate.status);

  updatePresenceForFriends(ws, '{}', false, true);

  global.Clients.splice(clientIndex, 1);

  for (const roomName of joinedMUCs) {
    if (global.MUCs[roomName]) {
      const memberIndex = global.MUCs[roomName].members.findIndex(
        (i) => i.accountId == client.accountId
      );

      if (memberIndex != -1) global.MUCs[roomName].members.splice(memberIndex, 1);
    }
  }

  let partyId = '';

  try {
    if (ClientStatus.Properties && isObject(ClientStatus.Properties)) {
      for (const key in ClientStatus.Properties) {
        if (key.toLowerCase().startsWith('party.joininfo')) {
          if (isObject(ClientStatus.Properties[key]))
            partyId = ClientStatus.Properties[key].partyId;
        }
      }
    }
  } catch {}

  if (partyId && typeof partyId == 'string') {
    // Also clean up the in-memory party state
    try {
      const partyCore = require('../core/party');
      partyCore.leaveParty(client.accountId, false);
    } catch {}
  }

  log(`An xmpp client with the displayName ${client.displayName} has logged out.`);
}

async function getPresenceFromFriends(ws: WebSocket, accountId: string, jid: string) {
  const friends = await Friends.findOne({ accountId: accountId }).lean();
  if (!friends) {
    log(`[getPresenceFromFriends] No friends document found for ${accountId}`);
    return;
  }

  const onlineStatus = JSON.stringify({
    Status: 'Battle Royale Lobby - 1 / 16',
    bIsPlaying: false,
    bIsJoinable: false,
    bHasVoiceSupport: false,
    SessionId: '',
    Properties: {},
  });

  const accepted = friends.list.accepted;
  log(`[getPresenceFromFriends] ${accountId} has ${accepted.length} friends, checking who's online...`);

  let onlineCount = 0;
  accepted.forEach((friend: any) => {
    const ClientData = global.Clients.find((i) => i.accountId == friend.accountId);
    if (!ClientData) return;

    onlineCount++;
    const status = ClientData.lastPresenceUpdate.status && ClientData.lastPresenceUpdate.status !== '{}'
      ? ClientData.lastPresenceUpdate.status
      : onlineStatus;

    let xml = XMLBuilder.create('presence')
      .attribute('to', jid)
      .attribute('xmlns', 'jabber:client')
      .attribute('from', ClientData.jid)
      .attribute('type', 'available');

    if (ClientData.lastPresenceUpdate.away)
      xml = xml.element('show', 'away').up().element('status', status).up();
    else xml = xml.element('status', status).up();

    ws.send(xml.toString());
    log(`[getPresenceFromFriends] Sent presence of ${friend.accountId} (online) to ${accountId}`);
  });
  
  log(`[getPresenceFromFriends] Sent ${onlineCount} online friend presences to ${accountId}`);
}

async function updatePresenceForFriends(
  ws: WebSocket,
  body: string,
  away: boolean,
  offline: boolean
) {
  const SenderIndex = global.Clients.findIndex((i) => i.client == ws);
  const SenderData = global.Clients[SenderIndex];

  if (SenderIndex == -1) {
    log(`[updatePresenceForFriends] Sender not found in Clients array`);
    return;
  }

  global.Clients[SenderIndex].lastPresenceUpdate.away = away;
  global.Clients[SenderIndex].lastPresenceUpdate.status = body;

  const friends = await Friends.findOne({ accountId: SenderData.accountId });
  if (!friends) {
    log(`[updatePresenceForFriends] No friends document for ${SenderData.accountId}`);
    return;
  }
  
  const accepted = friends.list.accepted;
  log(`[updatePresenceForFriends] Broadcasting ${offline ? 'offline' : 'online'} status from ${SenderData.accountId} to ${accepted.length} friends...`);

  let sentCount = 0;
  accepted.forEach((friend: any) => {
    const ClientData = global.Clients.find((i) => i.accountId == friend.accountId);
    if (!ClientData) return;

    sentCount++;
    let xml = XMLBuilder.create('presence')
      .attribute('to', ClientData.jid)
      .attribute('xmlns', 'jabber:client')
      .attribute('from', SenderData.jid)
      .attribute('type', offline ? 'unavailable' : 'available');

    if (away)
      xml = xml
        .element('show', 'away')
        .up()
        .element('status', body)
        .up();
    else xml = xml.element('status', body).up();

    ClientData.client.send(xml.toString());
    log(`[updatePresenceForFriends] Sent ${offline ? 'offline' : 'online'} presence to ${friend.accountId}`);
  });
  
  log(`[updatePresenceForFriends] Broadcast complete: ${sentCount} friends notified`);
}

function sendXmppMessageToClient(senderJid: string, msg: any, body: string | object) {
  if (typeof body == 'object') body = JSON.stringify(body);

  const receiver = global.Clients.find(
    (i) => i.jid.split('/')[0] == msg.root.attributes.to || i.jid == msg.root.attributes.to
  );
  if (!receiver) return;

  receiver.client.send(
    XMLBuilder.create('message')
      .attribute('from', senderJid)
      .attribute('id', msg.root.attributes.id)
      .attribute('to', receiver.jid)
      .attribute('xmlns', 'jabber:client')
      .element('body', `${body}`)
      .up()
      .toString()
  );
}

function getMUCmember(roomName: string, displayName: string, accountId: string, resource: string) {
  return `${roomName}@muc.${global.xmppDomain}/${encodeURI(displayName)}:${accountId}:${resource}`;
}

function isObject(value: any): boolean {
  if (typeof value == 'object' && !Array.isArray(value)) return true;
  else return false;
}

function isJSON(str: string): boolean {
  try {
    JSON.parse(str);
  } catch (err) {
    return false;
  }
  return true;
}

export function startXMPP() {
  // The XMPP WebSocket server is already initialized at module load time
  // This function just confirms it's ready
  log('XMPP server initialized');
  log(`XMPP WebSocket server listening on port ${port}`);
  log(`Clients can connect via ws://localhost:${port} with protocol 'xmpp'`);
}

export { queueOrSend };
export type { };

/**
 * Send each account's current presence to the other.
 * Called after a friend request is accepted so both show as online immediately.
 */
export function exchangePresence(accountIdA: string, accountIdB: string) {
  const clientA = global.Clients.find((c) => c.accountId === accountIdA);
  const clientB = global.Clients.find((c) => c.accountId === accountIdB);

  log(`[exchangePresence] A=${accountIdA} found=${!!clientA} | B=${accountIdB} found=${!!clientB}`);

  const onlineStatus = JSON.stringify({
    Status: 'Battle Royale Lobby - 1 / 16',
    bIsPlaying: false,
    bIsJoinable: false,
    bHasVoiceSupport: false,
    SessionId: '',
    Properties: {},
  });

  const sendPresence = (from: typeof clientA, to: typeof clientB) => {
    if (!from || !to) return;
    const status = from.lastPresenceUpdate.status && from.lastPresenceUpdate.status !== '{}'
      ? from.lastPresenceUpdate.status
      : onlineStatus;

    log(`[exchangePresence] Sending presence from ${from.accountId} to ${to.accountId}, status length=${status.length}`);

    let xml = XMLBuilder.create('presence')
      .attribute('to', to.jid)
      .attribute('from', from.jid)
      .attribute('xmlns', 'jabber:client')
      .attribute('type', 'available');

    if (from.lastPresenceUpdate.away) {
      xml = xml.element('show', 'away').up().element('status', status).up();
    } else {
      xml = xml.element('status', status).up();
    }

    to.client.send(xml.toString());
  };

  sendPresence(clientA, clientB);
  sendPresence(clientB, clientA);
}
