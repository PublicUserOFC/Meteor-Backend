// @ts-nocheck
import express, { Request, Response } from 'express';
import fs from 'fs';
import path from 'path';
const router = express.Router();

import { Friends } from '../../models/Friends';
import { Profile } from '../../models/Profile';
import { User } from '../../models/User';
import SACCodeModel from '../../models/SACCode';
import * as profileManager from '../../core/profile';
import * as error from '../../core/errors';
import * as functions from '../../core/utils';
import { backend as log, error as logError, debug } from '../../core/logger';
import { config } from '../../config';

import { verifyToken } from '../../middleware/auth';

import questsData from '../../../Base/responses/quests.json';
import winterfestRewards from '../../../Base/responses/winterfestRewards.json';

global.giftReceived = {};

// Purchase lock to prevent race conditions when spamming buy button
const purchaseLocks = new Map<string, boolean>();

function acquirePurchaseLock(accountId: string, offerId: string): boolean {
  const lockKey = `${accountId}:${offerId}`;
  if (purchaseLocks.get(lockKey)) {
    return false; // Lock already held
  }
  purchaseLocks.set(lockKey, true);
  return true;
}

function releasePurchaseLock(accountId: string, offerId: string): void {
  const lockKey = `${accountId}:${offerId}`;
  purchaseLocks.delete(lockKey);
}

router.post(
  "/fortnite/api/game/v2/profile/*/client/PurchaseMultipleCatalogEntries",
  verifyToken,
  async (req: Request, res: Response) => {
    const profiles = await Profile.findOne({ accountId: req.user.accountId });
    if (!profiles) return res.status(404).json({});

    const profile = profiles.profiles[req.query.profileId as string];
    const athena = profiles.profiles["athena"];
    const common_core = profiles.profiles["common_core"];
    const profile0 = profiles.profiles["profile0"];

    const ApplyProfileChanges: any[] = [];
    const Notifications: any[] = [];
    const BaseRevision = profile.rvn || 0;

    const purchases = req.body.purchaseInfoList || req.body.purchases || [];
    const memory = functions.GetVersionInfo(req);
    const bpSeason = memory.season || 19;

    const bpFilePath = path.join(__dirname, "../../../Base/responses/Athena/BattlePass/", `Season${bpSeason}.json`);
    let BattlePass: any = null;
    try {
      if (fs.existsSync(bpFilePath)) BattlePass = JSON.parse(fs.readFileSync(bpFilePath, "utf8"));
    } catch {}

    const MultiUpdate: any[] = [{
      profileRevision: athena.rvn || 0,
      profileId: "athena",
      profileChangesBaseRevision: athena.rvn || 0,
      profileChanges: [] as any[],
      profileCommandRevision: athena.commandRevision || 0,
    }];

    // Check if any purchase is a Battle Pass offer and acquire lock
    const bpOfferIds = BattlePass ? [BattlePass.battlePassOfferId, BattlePass.battleBundleOfferId, BattlePass.tierOfferId] : [];
    const hasBPPurchase = purchases.some((p: any) => bpOfferIds.includes(p.offerId));
    
    if (hasBPPurchase) {
      const lockKey = purchases.find((p: any) => bpOfferIds.includes(p.offerId))?.offerId;
      if (!acquirePurchaseLock(req.user.accountId, lockKey)) {
        console.log(`[PURCHASE] Blocked duplicate Battle Pass purchase attempt for ${req.user.accountId}`);
        return error.createError(
          "errors.com.epicgames.fortnite.purchase_in_progress",
          "A purchase is already in progress. Please wait.",
          [],
          16028,
          undefined,
          409,
          res,
        );
      }
    }

    try {
      for (const purchase of purchases) {
        const offerId: string = purchase.offerId;
        const quantity: number = purchase.purchaseQuantity || 1;

        if (!BattlePass) continue;

        const isTier = offerId === BattlePass.tierOfferId;
        const isPass = offerId === BattlePass.battlePassOfferId;
        const isBundle = offerId === BattlePass.battleBundleOfferId;

        if (!isTier && !isPass && !isBundle) continue;

        // Snapshot tier BEFORE any changes
        const startTier: number = athena.stats.attributes.book_level || 1;
        const alreadyOwnsBP = athena.stats.attributes.book_purchased === true;
        
        console.log(`[BP PURCHASE] User ${req.user.accountId} - startTier=${startTier}, alreadyOwnsBP=${alreadyOwnsBP}, isPass=${isPass}, isBundle=${isBundle}, isTier=${isTier}`);

        // If buying the pass/bundle and already own it, skip
        if ((isPass || isBundle) && alreadyOwnsBP) {
          console.log(`[PURCHASE] User ${req.user.accountId} already owns Battle Pass, skipping duplicate purchase`);
          continue;
        }

        const lootList: any[] = [];

        // Update book_purchased FIRST if buying pass/bundle
        if (isPass || isBundle) {
          athena.stats.attributes.book_purchased = true;
          MultiUpdate[0].profileChanges.push({
            changeType: "statModified",
            name: "book_purchased",
            value: true,
          });

          // Check if token already exists
          const tokenTemplateId = `Token:athena_s${bpSeason}_nobattlebundleoption_token`;
          const existingToken = Object.values(profile.items).find((item: any) => item.templateId === tokenTemplateId);
          
          if (!existingToken) {
            const tokenKey = functions.MakeID();
            const tokenData = {
              templateId: tokenTemplateId,
              attributes: { max_level_bonus: 0, level: 1, item_seen: true, xp: 0, favorite: false },
              quantity: 1,
            };
            profile.items[tokenKey] = tokenData;
            ApplyProfileChanges.push({ changeType: "itemAdded", itemId: tokenKey, item: tokenData });
          }
        }

        // Update tier levels BEFORE granting rewards
        if (isBundle) {
          athena.stats.attributes.book_level = Math.min(100, (athena.stats.attributes.book_level || 1) + 25);
          MultiUpdate[0].profileChanges.push({
            changeType: "statModified",
            name: "book_level",
            value: athena.stats.attributes.book_level,
          });
        }

        if (isTier) {
          const newLevel = Math.min(100, (athena.stats.attributes.book_level || 1) + quantity);
          athena.stats.attributes.book_level = newLevel;
          MultiUpdate[0].profileChanges.push({
            changeType: "statModified",
            name: "book_level",
            value: newLevel,
          });
        }

        // Grant rewards based on purchase type
        const endTier: number = athena.stats.attributes.book_level || 1;
        
        console.log(`[BP REWARDS] Processing rewards: startTier=${startTier}, endTier=${endTier}, isPass=${isPass}, isBundle=${isBundle}, isTier=${isTier}, alreadyOwnsBP=${alreadyOwnsBP}`);
        
        // Iterate through all relevant tiers
        for (let tier = 1; tier <= endTier; tier++) {
          const tierIndex = tier - 1; // Convert to 0-indexed array
          if (tierIndex < 0 || tierIndex >= 100) continue;
          
          const freeTier = BattlePass.freeRewards?.[tierIndex] || {};
          const paidTier = BattlePass.paidRewards?.[tierIndex] || {};
          
          // Determine what to grant for this tier
          let grantFree = false;
          let grantPaid = false;
          
          if (tier > startTier) {
            // New tier from this purchase
            grantFree = true;
            grantPaid = (isPass || isBundle || alreadyOwnsBP);
          } else if (tier <= startTier) {
            // Existing tier - only grant paid if just bought pass/bundle
            grantFree = false; // Already had free rewards
            grantPaid = (isPass || isBundle) && !alreadyOwnsBP;
          }
          
          if (!grantFree && !grantPaid) continue; // Nothing to grant for this tier
          
          const itemsToGrant = {
            ...(grantFree ? freeTier : {}),
            ...(grantPaid ? paidTier : {})
          };
          
          for (const [item, qty] of Object.entries(itemsToGrant) as [string, number][]) {
            const tl = item.toLowerCase();
            if (tl.startsWith("currency:")) continue;
            if (tl === "token:athenaseasonxpboost") {
              athena.stats.attributes.season_match_boost = (athena.stats.attributes.season_match_boost || 0) + qty;
              MultiUpdate[0].profileChanges.push({ changeType: "statModified", name: "season_match_boost", value: athena.stats.attributes.season_match_boost });
              continue;
            }
            if (tl === "token:athenaseasonfriendxpboost") {
              athena.stats.attributes.season_friend_match_boost = (athena.stats.attributes.season_friend_match_boost || 0) + qty;
              MultiUpdate[0].profileChanges.push({ changeType: "statModified", name: "season_friend_match_boost", value: athena.stats.attributes.season_friend_match_boost });
              continue;
            }
            
            // Check if item already exists
            const existingItemId = Object.keys(athena.items).find(key => athena.items[key].templateId === item);
            
            if (existingItemId) {
              // Item exists, increment quantity
              athena.items[existingItemId].quantity = (athena.items[existingItemId].quantity || 1) + qty;
              athena.items[existingItemId].attributes.item_seen = false;
              MultiUpdate[0].profileChanges.push({ 
                changeType: "itemQuantityChanged", 
                itemId: existingItemId, 
                quantity: athena.items[existingItemId].quantity 
              });
              lootList.push({ itemType: item, itemGuid: existingItemId, itemProfile: "athena", quantity: qty });
            } else {
              // New item
              const id = functions.MakeID();
              const newItem = {
                templateId: item,
                attributes: { max_level_bonus: 0, level: 1, item_seen: false, xp: 0, variants: [], favorite: false },
                quantity: qty,
              };
              athena.items[id] = newItem;
              MultiUpdate[0].profileChanges.push({ changeType: "itemAdded", itemId: id, item: newItem });
              lootList.push({ itemType: item, itemGuid: id, itemProfile: "athena", quantity: qty });
            }
          }
        }

        // Create gift box for the purchase screen animation
        // ALWAYS add to common_core profile (where Fortnite expects it)
        // Create gift box even if lootList is empty for debugging
        const giftBoxId = functions.MakeID();
        const giftBox = {
          templateId: isBundle ? "GiftBox:gb_battlepasspurchased" : isTier ? "GiftBox:gb_battlepass" : "GiftBox:gb_battlepasspurchased",
          attributes: {
            max_level_bonus: 0,
            fromAccountId: "",
            lootList,
            level: 1,
            item_seen: false,
            xp: 0,
            favorite: false,
          },
          quantity: 1,
        };
        
        // Add gift box to common_core (where Fortnite looks for it)
        common_core.items[giftBoxId] = giftBox;
        
        // If the request is on common_core profile, add to ApplyProfileChanges
        if (req.query.profileId === "common_core") {
          ApplyProfileChanges.push({ changeType: "itemAdded", itemId: giftBoxId, item: giftBox });
        }
        
        // Add notification for the purchase screen
        Notifications.push({
          type: "CatalogPurchase",
          primary: true,
          lootResult: {
            items: lootList
          }
        });
        
        console.log(`[GIFT BOX] Created gift box ${giftBoxId} with ${lootList.length} items in common_core profile (request on ${req.query.profileId})`);
        console.log(`[GIFT BOX] Gift box template: ${giftBox.templateId}`);
        console.log(`[GIFT BOX] LootList:`, JSON.stringify(lootList.slice(0, 3))); // Log first 3 items
        
        console.log(`[PURCHASE] Battle Pass purchase complete. Granted ${lootList.length} items. startTier=${startTier}, endTier=${endTier}`);
      }

      athena.rvn += 1;
      athena.commandRevision += 1;
      profile.rvn += 1;
      profile.commandRevision += 1;
      common_core.rvn += 1;
      common_core.commandRevision += 1;

      MultiUpdate[0].profileRevision = athena.rvn;
      MultiUpdate[0].profileCommandRevision = athena.commandRevision;

      await profiles.updateOne({
        $set: {
        [`profiles.${req.query.profileId}`]: profile,
        "profiles.athena": athena,
        "profiles.common_core": common_core,
        "profiles.profile0": profile0,
      },
    });

    res.json({
      profileRevision: profile.rvn || 0,
      profileId: req.query.profileId,
      profileChangesBaseRevision: BaseRevision,
      profileChanges: ApplyProfileChanges,
      notifications: Notifications,
      profileCommandRevision: profile.commandRevision || 0,
      serverTime: new Date().toISOString(),
      multiUpdate: MultiUpdate,
      responseVersion: 1,
    });
  } finally {
    // Release lock if it was acquired
    if (hasBPPurchase) {
      const lockKey = purchases.find((p: any) => bpOfferIds.includes(p.offerId))?.offerId;
      if (lockKey) {
        releasePurchaseLock(req.user.accountId, lockKey);
      }
    }
  }
  },
);

router.post(
  "/fortnite/api/game/v2/profile/*/client/SetReceiveGiftsEnabled",
  verifyToken,
  async (req: Request, res: Response) => {

    const profiles = await Profile.findOne({ accountId: req.user.accountId });

    if (
      !(await profileManager.validateProfile(req.query.profileId, profiles))
    ) {
      return error.createError(
        "errors.com.epicgames.modules.profiles.operation_forbidden",
        `Unable to find template configuration for profile ${req.query.profileId}`,
        [req.query.profileId],
        12813,
        undefined,
        403,
        res,
      );
    }

    let profile = profiles.profiles[req.query.profileId];

    if (req.query.profileId != "common_core") {
      return error.createError(
        "errors.com.epicgames.modules.profiles.invalid_command",
        `SetReceiveGiftsEnabled is not valid on ${req.query.profileId} profile`,
        ["SetReceiveGiftsEnabled", req.query.profileId],
        12801,
        undefined,
        400,
        res,
      );
    }

    const memory = functions.GetVersionInfo(req);

    let ApplyProfileChanges = [];
    let BaseRevision = profile.rvn;
    let ProfileRevisionCheck =
      memory.build >= 12.2 ? profile.commandRevision : profile.rvn;
    let QueryRevision = req.query.rvn || -1;

    if (typeof req.body.bReceiveGifts != "boolean") {
      return ValidationError("bReceiveGifts", "a boolean", res);
    }

    profile.stats.attributes.allowed_to_receive_gifts = req.body.bReceiveGifts;

    ApplyProfileChanges.push({
      changeType: "statModified",
      name: "allowed_to_receive_gifts",
      value: profile.stats.attributes.allowed_to_receive_gifts,
    });

    if (ApplyProfileChanges.length > 0) {
      profile.rvn += 1;
      profile.commandRevision += 1;
      profile.updated = new Date().toISOString();

      await profiles.updateOne({
        $set: { [`profiles.${req.query.profileId}`]: profile },
      });
    }

    if (QueryRevision != ProfileRevisionCheck) {
      ApplyProfileChanges = [
        {
          changeType: "fullProfileUpdate",
          profile: profile,
        },
      ];
    }

    res.json({
      profileRevision: profile.rvn || 0,
      profileId: req.query.profileId,
      profileChangesBaseRevision: BaseRevision,
      profileChanges: ApplyProfileChanges,
      profileCommandRevision: profile.commandRevision || 0,
      serverTime: new Date().toISOString(),
      responseVersion: 1,
    });
  },
);

router.post(
  "/fortnite/api/game/v2/profile/*/client/ClientQuestLogin",
  verifyToken,
  async (req: Request, res: Response) => {
    const profiles = await Profile.findOne({ accountId: req.user.accountId });

    if (!(await profileManager.validateProfile(req.query.profileId, profiles)))
      return error.createError(
        "errors.com.epicgames.modules.profiles.operation_forbidden",
        `Unable to find template configuration for profile ${req.query.profileId}`,
        [req.query.profileId],
        12813,
        undefined,
        403,
        res,
      );

    let profile = profiles.profiles[req.query.profileId];
    if (!profile.items) profile.items = {};
    let athena = profiles.profiles["athena"];
    if (!athena.items) athena.items = {};
    let AthenaQuestIDS = JSON.parse(
      JSON.stringify(questsData),
    );
    const memory = functions.GetVersionInfo(req);

    let ApplyProfileChanges = [];
    let Notifications = [];
    let BaseRevision = profile.rvn || 0;
    let QueryRevision = req.query.rvn || -1;
    let StatChanged = false;

    let QuestCount = 0;
    let ShouldGiveQuest = true;
    let DateFormat = new Date().toISOString().split("T")[0];
    let DailyQuestIDS;
    let SeasonQuestIDS;
    let QuestsToAdd = [];

    const SeasonPrefix =
      memory.season < 10 ? `0${memory.season}` : memory.season;

    try {
      if (req.query.profileId == "profile0") {
        for (let key in profile.items) {
          if (
            profile.items[key].templateId
              .toLowerCase()
              .startsWith("quest:daily")
          ) {
            QuestCount += 1;
          }
        }
      }

      if (req.query.profileId == "athena") {
        DailyQuestIDS = AthenaQuestIDS.Daily;

        if (AthenaQuestIDS.hasOwnProperty(`Season${SeasonPrefix}`)) {
          SeasonQuestIDS = AthenaQuestIDS[`Season${SeasonPrefix}`];
        }

        for (let key in profile.items) {
          if (
            profile.items[key].templateId
              .toLowerCase()
              .startsWith("quest:athenadaily")
          ) {
            QuestCount += 1;
          }
        }
      }

      if (profile.stats.attributes.hasOwnProperty("quest_manager")) {
        if (
          profile.stats.attributes.quest_manager.hasOwnProperty(
            "dailyLoginInterval",
          )
        ) {
          if (
            profile.stats.attributes.quest_manager.dailyLoginInterval.includes(
              "T",
            )
          ) {
            let DailyLoginDate =
              profile.stats.attributes.quest_manager.dailyLoginInterval.split(
                "T",
              )[0];

            if (DailyLoginDate == DateFormat) {
              ShouldGiveQuest = false;
            } else {
              ShouldGiveQuest = true;
              if (
                profile.stats.attributes.quest_manager.dailyQuestRerolls <= 0
              ) {
                profile.stats.attributes.quest_manager.dailyQuestRerolls += 1;
              }
            }
          }
        }
      }

      if (QuestCount < 3 && ShouldGiveQuest == true) {
        const selectedQuests = [];
        while (selectedQuests.length < 3) {
          const randomIndex = Math.floor(Math.random() * DailyQuestIDS.length);
          const quest = DailyQuestIDS[randomIndex];

          if (
            !Object.values(profile.items).some(
              (item) =>
                item.templateId.toLowerCase() ===
                quest.templateId.toLowerCase(),
            ) &&
            !selectedQuests.includes(quest)
          ) {
            selectedQuests.push(quest);
          }
        }

        for (const quest of selectedQuests) {
          const NewQuestID = functions.MakeID();

          profile.items[NewQuestID] = {
            templateId: quest.templateId,
            attributes: {
              creation_time: new Date().toISOString(),
              level: -1,
              item_seen: false,
              sent_new_notification: false,
              xp_reward_scalar: 1,
              quest_state: "Active",
              last_state_change_time: new Date().toISOString(),
              max_level_bonus: 0,
              xp: 0,
              favorite: false,
            },
            quantity: 1,
          };

          for (let i in quest.objectives) {
            profile.items[NewQuestID].attributes[
              `completion_${quest.objectives[i].toLowerCase()}`
            ] = 0;
          }

          ApplyProfileChanges.push({
            changeType: "itemAdded",
            itemId: NewQuestID,
            item: profile.items[NewQuestID],
          });
        }

        profile.stats.attributes.quest_manager.dailyLoginInterval =
          new Date().toISOString();

        ApplyProfileChanges.push({
          changeType: "statModified",
          name: "quest_manager",
          value: profile.stats.attributes.quest_manager,
        });

        StatChanged = true;
      }
    } catch (err) {
      logError(err);
    }

    for (let key in profile.items) {
      if (
        key.startsWith("QS") &&
        Number.isInteger(Number(key[2])) &&
        Number.isInteger(Number(key[3])) &&
        key[4] === "-"
      ) {
        if (!key.startsWith(`QS${SeasonPrefix}-`)) {
          delete profile.items[key];

          ApplyProfileChanges.push({
            changeType: "itemRemoved",
            itemId: key,
          });

          StatChanged = true;
        }
      }
    }

    if (SeasonQuestIDS) {
      if (req.query.profileId == "athena") {
        for (let ChallengeBundleScheduleID in SeasonQuestIDS.ChallengeBundleSchedules) {
          if (profile.items.hasOwnProperty(ChallengeBundleScheduleID)) {
            ApplyProfileChanges.push({
              changeType: "itemRemoved",
              itemId: ChallengeBundleScheduleID,
            });
          }

          let ChallengeBundleSchedule =
            SeasonQuestIDS.ChallengeBundleSchedules[ChallengeBundleScheduleID];

          profile.items[ChallengeBundleScheduleID] = {
            templateId: ChallengeBundleSchedule.templateId,
            attributes: {
              unlock_epoch: new Date().toISOString(),
              max_level_bonus: 0,
              level: 1,
              item_seen: true,
              xp: 0,
              favorite: false,
              granted_bundles: ChallengeBundleSchedule.granted_bundles,
            },
            quantity: 1,
          };

          ApplyProfileChanges.push({
            changeType: "itemAdded",
            itemId: ChallengeBundleScheduleID,
            item: profile.items[ChallengeBundleScheduleID],
          });

          StatChanged = true;
        }

        for (let ChallengeBundleID in SeasonQuestIDS.ChallengeBundles) {
          if (profile.items.hasOwnProperty(ChallengeBundleID)) {
            ApplyProfileChanges.push({
              changeType: "itemRemoved",
              itemId: ChallengeBundleID,
            });
          }

          let ChallengeBundle =
            SeasonQuestIDS.ChallengeBundles[ChallengeBundleID];

          if (
            config.features.enableBattlepass == true &&
            ChallengeBundle.hasOwnProperty("questStages")
          ) {
            ChallengeBundle.grantedquestinstanceids =
              ChallengeBundle.grantedquestinstanceids.concat(
                ChallengeBundle.questStages,
              );
          }

          profile.items[ChallengeBundleID] = {
            templateId: ChallengeBundle.templateId,
            attributes: {
              has_unlock_by_completion: false,
              num_quests_completed: 0,
              level: 0,
              grantedquestinstanceids: ChallengeBundle.grantedquestinstanceids,
              item_seen: true,
              max_allowed_bundle_level: 0,
              num_granted_bundle_quests: 0,
              max_level_bonus: 0,
              challenge_bundle_schedule_id:
                ChallengeBundle.challenge_bundle_schedule_id,
              num_progress_quests_completed: 0,
              xp: 0,
              favorite: false,
            },
            quantity: 1,
          };

          QuestsToAdd = QuestsToAdd.concat(
            ChallengeBundle.grantedquestinstanceids,
          );
          profile.items[
            ChallengeBundleID
          ].attributes.num_granted_bundle_quests =
            ChallengeBundle.grantedquestinstanceids.length;

          if (config.features.enableBattlepass == true) {
            profile.items[ChallengeBundleID].attributes.num_quests_completed =
              ChallengeBundle.grantedquestinstanceids.length;
            profile.items[
              ChallengeBundleID
            ].attributes.num_progress_quests_completed =
              ChallengeBundle.grantedquestinstanceids.length;

            if (
              (memory.season == 10 || memory.season == 11) &&
              (ChallengeBundle.templateId
                .toLowerCase()
                .includes("missionbundle_s10_0") ||
                ChallengeBundle.templateId.toLowerCase() ==
                  "challengebundle:missionbundle_s11_stretchgoals2")
            ) {
              profile.items[ChallengeBundleID].attributes.level += 1;
            }
          }

          ApplyProfileChanges.push({
            changeType: "itemAdded",
            itemId: ChallengeBundleID,
            item: profile.items[ChallengeBundleID],
          });

          StatChanged = true;
        }
      }
    }

    function ParseQuest(QuestID) {
      let Quest = SeasonQuestIDS.Quests[QuestID];
      if (!Quest) {
        return;
      }

      if (profile.items.hasOwnProperty(QuestID)) {
        ApplyProfileChanges.push({
          changeType: "itemRemoved",
          itemId: QuestID,
        });
      }

      profile.items[QuestID] = {
        templateId: Quest.templateId,
        attributes: {
          creation_time: new Date().toISOString(),
          level: -1,
          item_seen: true,
          sent_new_notification: true,
          challenge_bundle_id: Quest.challenge_bundle_id || "",
          xp_reward_scalar: 1,
          quest_state: "Active",
          last_state_change_time: new Date().toISOString(),
          max_level_bonus: 0,
          xp: 0,
          favorite: false,
        },
        quantity: 1,
      };

      if (config.features.enableBattlepass == true) {
        profile.items[QuestID].attributes.quest_state = "Claimed";

        if (Quest.hasOwnProperty("rewards")) {
          for (let reward in Quest.rewards) {
            if (Quest.rewards[reward].templateId.startsWith("Quest:")) {
              for (let Q in SeasonQuestIDS.Quests) {
                if (
                  SeasonQuestIDS.Quests[Q].templateId ==
                  Quest.rewards[reward].templateId
                ) {
                  SeasonQuestIDS.ChallengeBundles[
                    SeasonQuestIDS.Quests[Q].challenge_bundle_id
                  ].grantedquestinstanceids.push(Q);
                  ParseQuest(Q);
                }
              }
            }
          }
        }
      }

      for (let i in Quest.objectives) {
        if (config.features.enableBattlepass == true) {
          profile.items[QuestID].attributes[`completion_${i}`] =
            Quest.objectives[i];
        } else {
          profile.items[QuestID].attributes[`completion_${i}`] = 0;
        }
      }

      ApplyProfileChanges.push({
        changeType: "itemAdded",
        itemId: QuestID,
        item: profile.items[QuestID],
      });

      StatChanged = true;
    }

    for (let Quest in QuestsToAdd) {
      ParseQuest(QuestsToAdd[Quest]);
    }

    if (StatChanged == true) {
      profile.rvn += 1;
      profile.commandRevision += 1;
      profile.updated = new Date().toISOString();

      await profiles.updateOne({
        $set: { [`profiles.${req.query.profileId}`]: profile },
      });
    }

    // ClientQuestLogin always returns a fullProfileUpdate so the game
    // correctly displays all challenge bundles and quests on login
    ApplyProfileChanges = [
      {
        changeType: "fullProfileUpdate",
        profile: profile,
      },
    ];

    res.json({
      profileRevision: profile.rvn || 0,
      profileId: req.query.profileId,
      profileChangesBaseRevision: BaseRevision,
      profileChanges: ApplyProfileChanges,
      notifications: Notifications,
      profileCommandRevision: profile.commandRevision || 0,
      serverTime: new Date().toISOString(),
      responseVersion: 1,
    });
  },
);

router.post(
  "/fortnite/api/game/v2/profile/*/client/FortRerollDailyQuest",
  verifyToken,
  async (req: Request, res: Response) => {
    const profiles = await Profile.findOne({ accountId: req.user.accountId });
    const profile = profiles.profiles[req.query.profileId];

    const dailyQuests = questsData.Daily;

    const ApplyProfileChanges = [];
    const Notifications = [];
    let BaseRevision = profile.rvn || 0;
    const QueryRevision = req.query.rvn || -1;
    let StatChanged = false;

    const currentDate = new Date().toISOString().split("T")[0];
    if (!profile.stats.attributes.quest_manager) {
      profile.stats.attributes.quest_manager = {};
    }

    if (
      !profile.stats.attributes.quest_manager.dailyLoginInterval ||
      profile.stats.attributes.quest_manager.dailyLoginInterval.split(
        "T",
      )[0] !== currentDate
    ) {
      profile.stats.attributes.quest_manager.dailyLoginInterval =
        new Date().toISOString();

      const selectedQuests = [];
      while (selectedQuests.length < 3) {
        const randomIndex = Math.floor(Math.random() * dailyQuests.length);
        const quest = dailyQuests[randomIndex];

        if (
          !Object.values(profile.items).some(
            (item) =>
              item.templateId.toLowerCase() === quest.templateId.toLowerCase(),
          ) &&
          !selectedQuests.includes(quest)
        ) {
          selectedQuests.push(quest);
        }
      }

      for (const quest of selectedQuests) {
        const questId = functions.MakeID();
        profile.items[questId] = {
          templateId: quest.templateId,
          attributes: {
            creation_time: new Date().toISOString(),
            level: -1,
            item_seen: false,
            sent_new_notification: false,
            xp_reward_scalar: 1,
            quest_state: "Active",
            last_state_change_time: new Date().toISOString(),
            max_level_bonus: 0,
            xp: 0,
            favorite: false,
          },
          quantity: 1,
        };

        for (const objective of quest.objectives) {
          profile.items[questId].attributes[
            `completion_${objective.toLowerCase()}`
          ] = 0;
        }

        ApplyProfileChanges.push({
          changeType: "itemAdded",
          itemId: questId,
          item: profile.items[questId],
        });
      }

      ApplyProfileChanges.push({
        changeType: "statModified",
        name: "quest_manager",
        value: profile.stats.attributes.quest_manager,
      });

      StatChanged = true;
    }

    if (
      req.body.questId &&
      profile.stats.attributes.quest_manager.dailyQuestRerolls > 0
    ) {
      profile.stats.attributes.quest_manager.dailyQuestRerolls -= 1;

      delete profile.items[req.body.questId];

      const selectedQuests = [];
      while (selectedQuests.length < 1) {
        const randomIndex = Math.floor(Math.random() * dailyQuests.length);
        const quest = dailyQuests[randomIndex];

        if (
          !Object.values(profile.items).some(
            (item) =>
              item.templateId.toLowerCase() === quest.templateId.toLowerCase(),
          ) &&
          !selectedQuests.includes(quest)
        ) {
          selectedQuests.push(quest);
        }
      }

      const rerollQuestID = functions.MakeID();
      const quest = selectedQuests[0];
      profile.items[rerollQuestID] = {
        templateId: quest.templateId,
        attributes: {
          creation_time: new Date().toISOString(),
          level: -1,
          item_seen: false,
          sent_new_notification: false,
          xp_reward_scalar: 1,
          quest_state: "Active",
          last_state_change_time: new Date().toISOString(),
          max_level_bonus: 0,
          xp: 0,
          favorite: false,
        },
        quantity: 1,
      };

      for (const objective of quest.objectives) {
        profile.items[rerollQuestID].attributes[
          `completion_${objective.toLowerCase()}`
        ] = 0;
      }

      ApplyProfileChanges.push({
        changeType: "itemAdded",
        itemId: rerollQuestID,
        item: profile.items[rerollQuestID],
      });

      ApplyProfileChanges.push({
        changeType: "itemRemoved",
        itemId: req.body.questId,
      });

      Notifications.push({
        type: "dailyQuestReroll",
        primary: true,
        newQuestId: quest.templateId,
      });

      StatChanged = true;
    }

    if (StatChanged) {
      profile.rvn += 1;
      profile.commandRevision += 1;
      profile.updated = new Date().toISOString();

      await profiles.updateOne({
        $set: { [`profiles.${req.query.profileId}`]: profile },
      });
    }

    if (QueryRevision !== BaseRevision) {
      ApplyProfileChanges.splice(0, ApplyProfileChanges.length, {
        changeType: "fullProfileUpdate",
        profile: profile,
      });
    }

    res.json({
      profileRevision: profile.rvn || 0,
      profileId: req.query.profileId || "athena",
      profileChangesBaseRevision: BaseRevision,
      profileChanges: ApplyProfileChanges,
      notifications: Notifications,
      profileCommandRevision: profile.commandRevision || 0,
      serverTime: new Date().toISOString(),
      responseVersion: 1,
    });
  },
);

router.post(
  "/fortnite/api/game/v2/profile/*/client/MarkNewQuestNotificationSent",
  verifyToken,
  async (req: Request, res: Response) => {

    const profiles = await Profile.findOne({ accountId: req.user.accountId });

    if (
      !(await profileManager.validateProfile(req.query.profileId, profiles))
    ) {
      return error.createError(
        "errors.com.epicgames.modules.profiles.operation_forbidden",
        `Unable to find template configuration for profile ${req.query.profileId}`,
        [req.query.profileId],
        12813,
        undefined,
        403,
        res,
      );
    }

    let profile = profiles.profiles[req.query.profileId];

    let ApplyProfileChanges = [];
    let Notifications = [];
    let BaseRevision = profile.rvn || 0;
    let QueryRevision = req.query.rvn || -1;
    let StatChanged = false;

    if (req.body.itemIds) {
      for (let i in req.body.itemIds) {
        let id = req.body.itemIds[i];

        if (profile.items[id]) {
          profile.items[id].attributes.sent_new_notification = true;
          ApplyProfileChanges.push({
            changeType: "itemAttrChanged",
            itemId: id,
            attributeName: "sent_new_notification",
            attributeValue: true,
          });
        } else {
        }
      }

      StatChanged = true;
    }

    if (StatChanged == true) {
      profile.rvn += 1;
      profile.commandRevision += 1;
      profile.updated = new Date().toISOString();

      await profiles.updateOne({
        $set: { [`profiles.${req.query.profileId}`]: profile },
      });
    }

    if (QueryRevision != BaseRevision) {
      ApplyProfileChanges = [
        {
          changeType: "fullProfileUpdate",
          profile: profile,
        },
      ];
    }

    res.json({
      profileRevision: profile.rvn || 0,
      profileId: req.query.profileId,
      profileChangesBaseRevision: BaseRevision,
      profileChanges: ApplyProfileChanges,
      notifications: Notifications,
      profileCommandRevision: profile.commandRevision || 0,
      serverTime: new Date().toISOString(),
      responseVersion: 1,
    });
  },
);

router.post(
  "/fortnite/api/game/v2/profile/*/client/AthenaPinQuest",
  verifyToken,
  async (req: Request, res: Response) => {
    const profiles = await Profile.findOne({ accountId: req.user.accountId });
    let profile = profiles.profiles[req.query.profileId];

    let ApplyProfileChanges = [];
    let Notifications = [];
    let BaseRevision = profile.rvn || 0;
    let QueryRevision = req.query.rvn || -1;
    let StatChanged = false;

    if (profile.stats.attributes.hasOwnProperty("pinned_quest")) {
      profile.stats.attributes.pinned_quest = req.body.pinnedQuest || "";
      StatChanged = true;
    }

    if (StatChanged == true) {
      profile.rvn += 1;
      profile.commandRevision += 1;
      profile.updated = new Date().toISOString();

      ApplyProfileChanges.push({
        changeType: "statModified",
        name: "pinned_quest",
        value: profile.stats.attributes.pinned_quest,
      });

      await profiles.updateOne({
        $set: { [`profiles.${req.query.profileId}`]: profile },
      });
    }

    if (QueryRevision != BaseRevision) {
      ApplyProfileChanges = [
        {
          changeType: "fullProfileUpdate",
          profile: profile,
        },
      ];
    }

    res.json({
      profileRevision: profile.rvn || 0,
      profileId: req.query.profileId,
      profileChangesBaseRevision: BaseRevision,
      profileChanges: ApplyProfileChanges,
      notifications: Notifications,
      profileCommandRevision: profile.commandRevision || 0,
      serverTime: new Date().toISOString(),
      responseVersion: 1,
    });
  },
);

router.post(
  "/fortnite/api/game/v2/profile/*/client/GiftCatalogEntry",
  verifyToken,
  async (req: Request, res: Response) => {

    const profiles = await Profile.findOne({ accountId: req.user.accountId });

    if (
      !(await profileManager.validateProfile(req.query.profileId, profiles))
    ) {
      return error.createError(
        "errors.com.epicgames.modules.profiles.operation_forbidden",
        `Unable to find template configuration for profile ${req.query.profileId}`,
        [req.query.profileId],
        12813,
        undefined,
        403,
        res,
      );
    }

    let profile = profiles.profiles[req.query.profileId];
    let profile0 = profiles.profiles["profile0"];

    if (req.query.profileId != "common_core") {
      return error.createError(
        "errors.com.epicgames.modules.profiles.invalid_command",
        `GiftCatalogEntry is not valid on ${req.query.profileId} profile`,
        ["GiftCatalogEntry", req.query.profileId],
        12801,
        undefined,
        400,
        res,
      );
    }

    const memory = functions.GetVersionInfo(req);

    let Notifications = [];
    let ApplyProfileChanges = [];
    let BaseRevision = profile.rvn;
    let ProfileRevisionCheck =
      memory.build >= 12.2 ? profile.commandRevision : profile.rvn;
    let QueryRevision = req.query.rvn || -1;
    let validGiftBoxes = [
      "GiftBox:gb_default",
      "GiftBox:gb_giftwrap1",
      "GiftBox:gb_giftwrap2",
      "GiftBox:gb_giftwrap3",
    ];

    let missingFields = checkFields(
      ["offerId", "receiverAccountIds", "giftWrapTemplateId"],
      req.body,
    );

    if (missingFields.fields.length > 0) {
      return error.createError(
        "errors.com.epicgames.validation.validation_failed",
        `Validation Failed. [${missingFields.fields.join(", ")}] field(s) is missing.`,
        [`[${missingFields.fields.join(", ")}]`],
        1040,
        undefined,
        400,
        res,
      );
    }

    if (typeof req.body.offerId != "string") {
      return ValidationError("offerId", "a string", res);
    }
    if (!Array.isArray(req.body.receiverAccountIds)) {
      return ValidationError("receiverAccountIds", "an array", res);
    }
    if (typeof req.body.giftWrapTemplateId != "string") {
      return ValidationError("giftWrapTemplateId", "a string", res);
    }
    if (typeof req.body.personalMessage != "string") {
      return ValidationError("personalMessage", "a string", res);
    }

    if (req.body.personalMessage.length > 100) {
      return error.createError(
        "errors.com.epicgames.string.length_check",
        `The personalMessage you provided is longer than 100 characters, please make sure your personal message is less than 100 characters long and try again.`,
        undefined,
        16027,
        undefined,
        400,
        res,
      );
    }

    if (!validGiftBoxes.includes(req.body.giftWrapTemplateId)) {
      return error.createError(
        "errors.com.epicgames.giftbox.invalid",
        `The giftbox you provided is invalid, please provide a valid giftbox and try again.`,
        undefined,
        16027,
        undefined,
        400,
        res,
      );
    }

    if (
      req.body.receiverAccountIds.length < 1 ||
      req.body.receiverAccountIds.length > 5
    ) {
      return error.createError(
        "errors.com.epicgames.item.quantity.range_check",
        `You need to atleast gift to 1 person and can not gift to more than 5 people.`,
        undefined,
        16027,
        undefined,
        400,
        res,
      );
    }

    if (checkIfDuplicateExists(req.body.receiverAccountIds)) {
      return error.createError(
        "errors.com.epicgames.array.duplicate_found",
        `There are duplicate accountIds in receiverAccountIds, please remove the duplicates and try again.`,
        undefined,
        16027,
        undefined,
        400,
        res,
      );
    }

    let sender = await Friends.findOne({
      accountId: req.user.accountId,
    }).lean();

    for (let receiverId of req.body.receiverAccountIds) {
      if (typeof receiverId != "string") {
        return error.createError(
          "errors.com.epicgames.array.invalid_string",
          `There is a non-string object inside receiverAccountIds, please provide a valid value and try again.`,
          undefined,
          16027,
          undefined,
          400,
          res,
        );
      }

      if (
        !sender.list.accepted.find((i) => i.accountId == receiverId) &&
        receiverId != req.user.accountId
      ) {
        return error.createError(
          "errors.com.epicgames.friends.no_relationship",
          `User ${req.user.accountId} is not friends with ${receiverId}`,
          [req.user.accountId, receiverId],
          28004,
          undefined,
          403,
          res,
        );
      }
    }

    if (!profile.items) profile.items = {};

    let findOfferId = functions.getOfferID(req.body.offerId);
    if (!findOfferId) {
      return error.createError(
        "errors.com.epicgames.fortnite.id_invalid",
        `Offer ID (id: '${req.body.offerId}') not found`,
        [req.body.offerId],
        16027,
        undefined,
        400,
        res,
      );
    }

    switch (true) {
      case /^BR(Daily|Weekly)Storefront$/.test(findOfferId.name):
        if (
          findOfferId.offerId.prices[0].currencyType.toLowerCase() ==
          "mtxcurrency"
        ) {
          let paid = false;
          let price =
            findOfferId.offerId.prices[0].finalPrice *
            req.body.receiverAccountIds.length;

          for (let key in profile.items) {
            if (
              !profile.items[key].templateId
                .toLowerCase()
                .startsWith("currency:mtx")
            )
              continue;

            let currencyPlatform = profile.items[key].attributes.platform;
            if (
              currencyPlatform.toLowerCase() !=
                profile.stats.attributes.current_mtx_platform.toLowerCase() &&
              currencyPlatform.toLowerCase() != "shared"
            )
              continue;

            if (profile.items[key].quantity < price) {
              return error.createError(
                "errors.com.epicgames.currency.mtx.insufficient",
                `You can not afford this item (${price}), you only have ${profile.items[key].quantity}.`,
                [`${price}`, `${profile.items[key].quantity}`],
                1040,
                undefined,
                400,
                res,
              );
            }

            profile.items[key].quantity -= price;
            profile0.items[key].quantity -= price;

            ApplyProfileChanges.push(
              {
                changeType: "itemQuantityChanged",
                itemId: key,
                quantity: profile.items[key].quantity,
              },
              {
                changeType: "itemQuantityChanged",
                itemId: key,
                quantity: profile0.items[key].quantity,
              },
            );

            paid = true;
            break;
          }

          if (!paid && price > 0) {
            return error.createError(
              "errors.com.epicgames.currency.mtx.insufficient",
              `You can not afford this item.`,
              [],
              1040,
              undefined,
              400,
              res,
            );
          }
        }

        for (let receiverId of req.body.receiverAccountIds) {
          const receiverProfiles = await Profile.findOne({
            accountId: receiverId,
          });
          let athena = receiverProfiles.profiles["athena"];
          let common_core = receiverProfiles.profiles["common_core"];

          if (!athena.items) athena.items = {};

          if (!common_core.stats.attributes.allowed_to_receive_gifts) {
            return error.createError(
              "errors.com.epicgames.user.gift_disabled",
              `User ${receiverId} has disabled receiving gifts.`,
              [receiverId],
              28004,
              undefined,
              403,
              res,
            );
          }

          for (let itemGrant of findOfferId.offerId.itemGrants) {
            for (let itemId in athena.items) {
              if (
                itemGrant.templateId.toLowerCase() ==
                athena.items[itemId].templateId.toLowerCase()
              ) {
                return error.createError(
                  "errors.com.epicgames.modules.gamesubcatalog.purchase_not_allowed",
                  `User ${receiverId} already owns this item.`,
                  [receiverId],
                  28004,
                  undefined,
                  403,
                  res,
                );
              }
            }
          }
        }

        for (let receiverId of req.body.receiverAccountIds) {
          const receiverProfiles = await Profile.findOne({
            accountId: receiverId,
          });
          let athena = receiverProfiles.profiles["athena"];
          let common_core =
            receiverId == req.user.accountId
              ? profile
              : receiverProfiles.profiles["common_core"];

          let giftBoxItemID = functions.MakeID();
          let giftBoxItem = {
            templateId: req.body.giftWrapTemplateId,
            attributes: {
              fromAccountId: req.user.accountId,
              lootList: [],
              params: {
                userMessage: req.body.personalMessage,
              },
              level: 1,
              giftedOn: new Date().toISOString(),
            },
            quantity: 1,
          };

          if (!athena.items) athena.items = {};
          if (!common_core.items) common_core.items = {};

          for (let value of findOfferId.offerId.itemGrants) {
            const ID = functions.MakeID();
            const templateLower = value.templateId.toLowerCase();

            if (templateLower.startsWith("homebasebanner")) {
              const Item = { templateId: value.templateId, attributes: { item_seen: false }, quantity: 1 };
              common_core.items[ID] = Item;
              giftBoxItem.attributes.lootList.push({ itemType: Item.templateId, itemGuid: ID, itemProfile: "common_core", quantity: 1 });
            } else if (templateLower.startsWith("currency:mtx")) {
              for (let key in common_core.items) {
                if (!common_core.items[key].templateId?.toLowerCase().startsWith("currency:mtx")) continue;
                common_core.items[key].quantity += value.quantity || 1;
                giftBoxItem.attributes.lootList.push({ itemType: value.templateId, itemGuid: key, itemProfile: "common_core", quantity: value.quantity || 1 });
                break;
              }
            } else {
              const Item = {
                templateId: value.templateId,
                attributes: { item_seen: false, variants: [], max_level_bonus: 0, level: 1, xp: 0, favorite: false },
                quantity: value.quantity || 1,
              };
              athena.items[ID] = Item;
              giftBoxItem.attributes.lootList.push({ itemType: Item.templateId, itemGuid: ID, itemProfile: "athena", quantity: Item.quantity });
            }
          }

          common_core.items[giftBoxItemID] = giftBoxItem;
          profile0.items[giftBoxItemID] = giftBoxItem;

          if (receiverId == req.user.accountId) {
            ApplyProfileChanges.push(
              {
                changeType: "itemAdded",
                itemId: giftBoxItemID,
                item: common_core.items[giftBoxItemID],
              },
              {
                changeType: "itemAdded",
                itemId: giftBoxItemID,
                item: profile0.items[giftBoxItemID],
              },
            );
          }

          athena.rvn += 1;
          athena.commandRevision += 1;
          athena.updated = new Date().toISOString();

          common_core.rvn += 1;
          common_core.commandRevision += 1;
          common_core.updated = new Date().toISOString();

          profile0.rvn += 1;
          profile0.commandRevision += 1;
          profile0.updated = new Date().toISOString();

          await receiverProfiles.updateOne({
            $set: {
              [`profiles.athena`]: athena,
              [`profiles.common_core`]: common_core,
              [`profiles.profile0`]: profile0,
            },
          });

          global.giftReceived[receiverId] = true;

          functions.sendXmppMessageToId(
            {
              type: "com.epicgames.gift.received",
              payload: {},
              timestamp: new Date().toISOString(),
            },
            receiverId,
          );
        }
        break;
    }

    if (
      ApplyProfileChanges.length > 0 &&
      !req.body.receiverAccountIds.includes(req.user.accountId)
    ) {
      profile.rvn += 1;
      profile.commandRevision += 1;
      profile.updated = new Date().toISOString();

      await profiles.updateOne({
        $set: {
          [`profiles.${req.query.profileId}`]: profile,
          [`profiles.profile0`]: profile0,
        },
      });
    }

    if (QueryRevision != ProfileRevisionCheck) {
      ApplyProfileChanges = [
        {
          changeType: "fullProfileUpdate",
          profile: profile,
        },
      ];
    }

    res.json({
      profileRevision: profile.rvn || 0,
      profileId: req.query.profileId,
      profileChangesBaseRevision: BaseRevision,
      profileChanges: ApplyProfileChanges,
      notifications: Notifications,
      profileCommandRevision: profile.commandRevision || 0,
      serverTime: new Date().toISOString(),
      responseVersion: 1,
    });
  },
);

router.post(
  "/fortnite/api/game/v2/profile/*/client/SetActiveArchetype",
  async (req: Request, res: Response) => {
    const profiles = await Profile.findOne({ accountId: req.user.accountId });
    let profile = profiles.profiles[req.query.profileId];

    let ApplyProfileChanges = [];
    let BaseRevision = profile.rvn || 0;
    let QueryRevision = req.query.rvn || -1;
    let StatChanged = false;

    if (req.body.archetypeGroup && req.body.archetype) {
      if (
        !profile.stats.attributes.hasOwnProperty("loadout_archetype_values")
      ) {
        profile.stats.attributes.loadout_archetype_values = {};
      }

      profile.stats.attributes.loadout_archetype_values[
        req.body.archetypeGroup
      ] = req.body.archetype;
      StatChanged = true;
    }

    if (StatChanged == true) {
      profile.rvn += 1;
      profile.commandRevision += 1;

      ApplyProfileChanges.push({
        changeType: "statModified",
        name: "loadout_archetype_values",
        value: profile.stats.attributes.loadout_archetype_values,
      });

      await profiles.updateOne({
        $set: { [`profiles.${req.query.profileId}`]: profile },
      });
    }

    if (QueryRevision != BaseRevision) {
      ApplyProfileChanges = [
        {
          changeType: "fullProfileUpdate",
          profile: profile,
        },
      ];
    }

    res.json({
      profileRevision: profile.rvn || 0,
      profileId: req.query.profileId,
      profileChangesBaseRevision: BaseRevision,
      profileChanges: ApplyProfileChanges,
      profileCommandRevision: profile.commandRevision || 0,
      serverTime: new Date().toISOString(),
      responseVersion: 1,
    });
  },
);

router.post(
  "/fortnite/api/game/v2/profile/*/client/UnlockRewardNode",
  verifyToken,
  async (req: Request, res: Response) => {
    const profiles = await Profile.findOne({ accountId: req.user.accountId });
    let profile = profiles.profiles[req.query.profileId];
    let common_core = profiles.profiles["common_core"];
    const WinterFestIDS = winterfestRewards;
    const memory = functions.GetVersionInfo(req);

    let ApplyProfileChanges = [];
    let MultiUpdate = [];
    let BaseRevision = profile.rvn;
    let ProfileRevisionCheck =
      memory.build >= 19.01 ? profile.commandRevision : profile.rvn;
    let QueryRevision = req.query.rvn || -1;
    let StatChanged = false;
    let CommonCoreChanged = false;
    let ItemExists = false;
    let Season = "Season" + memory.season;

    const GiftID = functions.MakeID();
    profile.items[GiftID] = {
      templateId: "GiftBox:gb_winterfestreward",
      attributes: {
        max_level_bonus: 0,
        fromAccountId: "",
        lootList: [],
        level: 1,
        item_seen: false,
        xp: 0,
        giftedOn: new Date().toISOString(),
        params: { SubGame: "Athena", winterfestGift: "true" },
        favorite: false,
      },
      quantity: 1,
    };

    if (req.body.nodeId && req.body.rewardGraphId
        && WinterFestIDS[Season]
        && WinterFestIDS[Season][req.body.nodeId]
        && profile.items[req.body.rewardGraphId]) {
      const rewardList: string[] = WinterFestIDS[Season][req.body.nodeId];
      for (let i = 0; i < rewardList.length; i++) {
        let ID = functions.MakeID();
        const Reward = rewardList[i];

        if (Reward.toLowerCase().startsWith("homebasebannericon:")) {
          if (CommonCoreChanged == false) {
            MultiUpdate.push({
              profileRevision: common_core.rvn || 0,
              profileId: "common_core",
              profileChangesBaseRevision: common_core.rvn || 0,
              profileChanges: [],
              profileCommandRevision: common_core.commandRevision || 0,
            });

            CommonCoreChanged = true;
          }

          for (let key in common_core.items) {
            if (
              common_core.items[key].templateId.toLowerCase() ==
              Reward.toLowerCase()
            ) {
              common_core.items[key].attributes.item_seen = false;
              ID = key;
              ItemExists = true;

              MultiUpdate[0].profileChanges.push({
                changeType: "itemAttrChanged",
                itemId: key,
                attributeName: "item_seen",
                attributeValue: common_core.items[key].attributes.item_seen,
              });
            }
          }

          if (ItemExists == false) {
            common_core.items[ID] = {
              templateId: Reward,
              attributes: {
                max_level_bonus: 0,
                level: 1,
                item_seen: false,
                xp: 0,
                variants: [],
                favorite: false,
              },
              quantity: 1,
            };

            MultiUpdate[0].profileChanges.push({
              changeType: "itemAdded",
              itemId: ID,
              item: common_core.items[ID],
            });
          }

          ItemExists = false;

          common_core.rvn += 1;
          common_core.commandRevision += 1;

          MultiUpdate[0].profileRevision = common_core.rvn || 0;
          MultiUpdate[0].profileCommandRevision =
            common_core.commandRevision || 0;

          profile.items[GiftID].attributes.lootList.push({
            itemType: Reward,
            itemGuid: ID,
            itemProfile: "common_core",
            attributes: { creation_time: new Date().toISOString() },
            quantity: 1,
          });
        }

        if (!Reward.toLowerCase().startsWith("homebasebannericon:")) {
          for (let key in profile.items) {
            if (
              profile.items[key].templateId.toLowerCase() ==
              Reward.toLowerCase()
            ) {
              profile.items[key].attributes.item_seen = false;
              ID = key;
              ItemExists = true;

              ApplyProfileChanges.push({
                changeType: "itemAttrChanged",
                itemId: key,
                attributeName: "item_seen",
                attributeValue: profile.items[key].attributes.item_seen,
              });
            }
          }

          if (ItemExists == false) {
            profile.items[ID] = {
              templateId: Reward,
              attributes: {
                max_level_bonus: 0,
                level: 1,
                item_seen: false,
                xp: 0,
                variants: [],
                favorite: false,
              },
              quantity: 1,
            };

            ApplyProfileChanges.push({
              changeType: "itemAdded",
              itemId: ID,
              item: profile.items[ID],
            });
          }

          ItemExists = false;

          profile.items[GiftID].attributes.lootList.push({
            itemType: Reward,
            itemGuid: ID,
            itemProfile: "athena",
            attributes: { creation_time: new Date().toISOString() },
            quantity: 1,
          });
        }
      }
      profile.items[
        req.body.rewardGraphId
      ].attributes.reward_keys[0].unlock_keys_used += 1;
      profile.items[
        req.body.rewardGraphId
      ].attributes.reward_nodes_claimed.push(req.body.nodeId);

      StatChanged = true;
    }

    if (StatChanged == true) {
      profile.rvn += 1;
      profile.commandRevision += 1;

      ApplyProfileChanges.push({
        changeType: "itemAdded",
        itemId: GiftID,
        item: profile.items[GiftID],
      });

      ApplyProfileChanges.push({
        changeType: "itemAttrChanged",
        itemId: req.body.rewardGraphId,
        attributeName: "reward_keys",
        attributeValue:
          profile.items[req.body.rewardGraphId].attributes.reward_keys,
      });

      ApplyProfileChanges.push({
        changeType: "itemAttrChanged",
        itemId: req.body.rewardGraphId,
        attributeName: "reward_nodes_claimed",
        attributeValue:
          profile.items[req.body.rewardGraphId].attributes.reward_nodes_claimed,
      });

      if (memory.season == 19 && profile.items.S19_GIFT_KEY) {
        profile.items.S19_GIFT_KEY.quantity -= 1;

        ApplyProfileChanges.push({
          changeType: "itemQuantityChanged",
          itemId: "S19_GIFT_KEY",
          quantity: profile.items.S19_GIFT_KEY.quantity,
        });
      }

      if (memory.season == 11 && profile.items.S11_GIFT_KEY) {
        profile.items.S11_GIFT_KEY.quantity -= 1;

        ApplyProfileChanges.push({
          changeType: "itemQuantityChanged",
          itemId: "S11_GIFT_KEY",
          quantity: profile.items.S11_GIFT_KEY.quantity,
        });
      }

      if (CommonCoreChanged == true) {
        await profiles.updateOne({
          $set: {
            [`profiles.${req.query.profileId}`]: profile,
            "profiles.common_core": common_core,
          },
        });
      } else {
        await profiles.updateOne({
          $set: { [`profiles.${req.query.profileId}`]: profile },
        });
      }
    }

    if (QueryRevision != ProfileRevisionCheck) {
      ApplyProfileChanges = [
        {
          changeType: "fullProfileUpdate",
          profile: profile,
        },
      ];
    }

    res.json({
      profileRevision: profile.rvn || 0,
      profileId: req.query.profileId,
      profileChangesBaseRevision: BaseRevision,
      profileChanges: ApplyProfileChanges,
      profileCommandRevision: profile.commandRevision || 0,
      serverTime: new Date().toISOString(),
      multiUpdate: MultiUpdate,
      responseVersion: 1,
    });
  },
);

router.post(
  "/fortnite/api/game/v2/profile/*/client/RemoveGiftBox",
  verifyToken,
  async (req: Request, res: Response) => {
    const profiles = await Profile.findOne({ accountId: req.user.accountId });

    if (!(await profileManager.validateProfile(req.query.profileId, profiles)))
      return error.createError(
        "errors.com.epicgames.modules.profiles.operation_forbidden",
        `Unable to find template configuration for profile ${req.query.profileId}`,
        [req.query.profileId],
        12813,
        undefined,
        403,
        res,
      );

    let profile = profiles.profiles[req.query.profileId];

    if (
      req.query.profileId != "athena" &&
      req.query.profileId != "common_core" &&
      req.query.profileId != "profile0"
    )
      return error.createError(
        "errors.com.epicgames.modules.profiles.invalid_command",
        `RemoveGiftBox is not valid on ${req.query.profileId} profile`,
        ["RemoveGiftBox", req.query.profileId],
        12801,
        undefined,
        400,
        res,
      );

    const memory = functions.GetVersionInfo(req);

    let ApplyProfileChanges = [];
    let BaseRevision = profile.rvn;
    let ProfileRevisionCheck =
      memory.build >= 12.2 ? profile.commandRevision : profile.rvn;
    let QueryRevision = req.query.rvn || -1;

    if (typeof req.body.giftBoxItemId == "string") {
      if (!profile.items[req.body.giftBoxItemId])
        return error.createError(
          "errors.com.epicgames.fortnite.id_invalid",
          `Item (id: '${req.body.giftBoxItemId}') not found`,
          [req.body.giftBoxItemId],
          16027,
          undefined,
          400,
          res,
        );

      if (
        !profile.items[req.body.giftBoxItemId].templateId.startsWith("GiftBox:")
      )
        return error.createError(
          "errors.com.epicgames.fortnite.id_invalid",
          `The specified item id is not a giftbox.`,
          [req.body.giftBoxItemId],
          16027,
          undefined,
          400,
          res,
        );

      delete profile.items[req.body.giftBoxItemId];

      ApplyProfileChanges.push({
        changeType: "itemRemoved",
        itemId: req.body.giftBoxItemId,
      });
    }

    if (Array.isArray(req.body.giftBoxItemIds)) {
      for (let giftBoxItemId of req.body.giftBoxItemIds) {
        if (typeof giftBoxItemId != "string") continue;
        if (!profile.items[giftBoxItemId]) continue;
        if (!profile.items[giftBoxItemId].templateId.startsWith("GiftBox:"))
          continue;

        delete profile.items[giftBoxItemId];

        ApplyProfileChanges.push({
          changeType: "itemRemoved",
          itemId: giftBoxItemId,
        });
      }
    }

    if (ApplyProfileChanges.length > 0) {
      profile.rvn += 1;
      profile.commandRevision += 1;
      profile.updated = new Date().toISOString();

      await profiles.updateOne({
        $set: { [`profiles.${req.query.profileId}`]: profile },
      });
    }

    if (QueryRevision != ProfileRevisionCheck) {
      ApplyProfileChanges = [
        {
          changeType: "fullProfileUpdate",
          profile: profile,
        },
      ];
    }

    res.json({
      profileRevision: profile.rvn || 0,
      profileId: req.query.profileId,
      profileChangesBaseRevision: BaseRevision,
      profileChanges: ApplyProfileChanges,
      profileCommandRevision: profile.commandRevision || 0,
      serverTime: new Date().toISOString(),
      responseVersion: 1,
    });
  },
);

router.post(
  "/fortnite/api/game/v2/profile/*/client/SetPartyAssistQuest",
  verifyToken,
  async (req: Request, res: Response) => {
    const profiles = await Profile.findOne({ accountId: req.user.accountId });
    let profile = profiles.profiles[req.query.profileId];

    const memory = functions.GetVersionInfo(req);

    let ApplyProfileChanges = [];
    let BaseRevision = profile.rvn;
    let ProfileRevisionCheck =
      memory.build >= 12.2 ? profile.commandRevision : profile.rvn;
    let QueryRevision = req.query.rvn || -1;
    let StatChanged = false;

    if (profile.stats.attributes.hasOwnProperty("party_assist_quest")) {
      profile.stats.attributes.party_assist_quest =
        req.body.questToPinAsPartyAssist || "";
      StatChanged = true;
    }

    if (StatChanged == true) {
      profile.rvn += 1;
      profile.commandRevision += 1;

      ApplyProfileChanges.push({
        changeType: "statModified",
        name: "party_assist_quest",
        value: profile.stats.attributes.party_assist_quest,
      });

      await profiles.updateOne({
        $set: { [`profiles.${req.query.profileId}`]: profile },
      });
    }

    if (QueryRevision != ProfileRevisionCheck) {
      ApplyProfileChanges = [
        {
          changeType: "fullProfileUpdate",
          profile: profile,
        },
      ];
    }

    res.json({
      profileRevision: profile.rvn || 0,
      profileId: req.query.profileId,
      profileChangesBaseRevision: BaseRevision,
      profileChanges: ApplyProfileChanges,
      profileCommandRevision: profile.commandRevision || 0,
      serverTime: new Date().toISOString(),
      responseVersion: 1,
    });
  },
);

router.post(
  "/fortnite/api/game/v2/profile/*/client/UpdateQuestClientObjectives",
  verifyToken,
  async (req: Request, res: Response) => {
    const profiles = await Profile.findOne({ accountId: req.user.accountId });
    let profile = profiles.profiles[req.query.profileId];
    const memory = functions.GetVersionInfo(req);

    let ApplyProfileChanges = [];
    let BaseRevision = profile.rvn;
    let ProfileRevisionCheck =
      memory.build >= 12.2 ? profile.commandRevision : profile.rvn;
    let QueryRevision = req.query.rvn || -1;
    let StatChanged = false;

    if (req.body.advance) {
      for (let i in req.body.advance) {
        let QuestsToUpdate = [];

        for (let x in profile.items) {
          if (profile.items[x].templateId.toLowerCase().startsWith("quest:")) {
            for (let y in profile.items[x].attributes) {
              if (
                y.toLowerCase() == `completion_${req.body.advance[i].statName}`
              ) {
                QuestsToUpdate.push(x);
              }
            }
          }
        }

        for (let i = 0; i < QuestsToUpdate.length; i++) {
          let bIncomplete = false;

          profile.items[QuestsToUpdate[i]].attributes[
            `completion_${req.body.advance[i].statName}`
          ] = req.body.advance[i].count;

          ApplyProfileChanges.push({
            changeType: "itemAttrChanged",
            itemId: QuestsToUpdate[i],
            attributeName: `completion_${req.body.advance[i].statName}`,
            attributeValue: req.body.advance[i].count,
          });

          if (
            profile.items[
              QuestsToUpdate[i]
            ].attributes.quest_state.toLowerCase() != "claimed"
          ) {
            for (let x in profile.items[QuestsToUpdate[i]].attributes) {
              if (x.toLowerCase().startsWith("completion_")) {
                if (profile.items[QuestsToUpdate[i]].attributes[x] == 0) {
                  bIncomplete = true;
                }
              }
            }

            if (bIncomplete == false) {
              profile.items[QuestsToUpdate[i]].attributes.quest_state =
                "Claimed";

              ApplyProfileChanges.push({
                changeType: "itemAttrChanged",
                itemId: QuestsToUpdate[i],
                attributeName: "quest_state",
                attributeValue:
                  profile.items[QuestsToUpdate[i]].attributes.quest_state,
              });
            }
          }

          StatChanged = true;
        }
      }
    }

    if (StatChanged == true) {
      profile.rvn += 1;
      profile.commandRevision += 1;

      await profiles.updateOne({
        $set: { [`profiles.${req.query.profileId}`]: profile },
      });
    }

    if (QueryRevision != ProfileRevisionCheck) {
      ApplyProfileChanges = [
        {
          changeType: "fullProfileUpdate",
          profile: profile,
        },
      ];
    }

    res.json({
      profileRevision: profile.rvn || 0,
      profileId: req.query.profileId,
      profileChangesBaseRevision: BaseRevision,
      profileChanges: ApplyProfileChanges,
      profileCommandRevision: profile.commandRevision || 0,
      serverTime: new Date().toISOString(),
      responseVersion: 1,
    });
  },
);

router.post(
  "/fortnite/api/game/v2/profile/*/client/RequestRestedStateIncrease",
  async (req: Request, res: Response) => {
    const profiles = await Profile.findOne({ accountId: req.params[0] });
    let profile = profiles.profiles[req.query.profileId];
    const memory = functions.GetVersionInfo(req);

    let ApplyProfileChanges = [];
    let BaseRevision = profile.rvn;
    let ProfileRevisionCheck =
      memory.build >= 12.2 ? profile.commandRevision : profile.rvn;
    let QueryRevision = req.query.rvn || -1;
    let StatChanged = false;
    let xp =
      profile.stats.attributes["book_xp"] + req.body.restedXpGenAccumulated;

    if (xp !== profile.stats.attributes["book_xp"]) {
      StatChanged = true;
      profile.stats.attributes["book_xp"] = xp;
      profile.stats.attributes["xp"] = xp;
    }

    if (StatChanged == true) {
      profile.rvn += 1;
      profile.commandRevision += 1;
      ApplyProfileChanges.push(
        {
          changeType: "statModified",
          name: "book_xp",
          value: profile.stats.attributes.book_xp,
        },
        {
          changeType: "statModified",
          name: "xp",
          value: profile.stats.attributes.xp,
        },
      );
      await profiles.updateOne({
        $set: { [`profiles.${req.query.profileId}`]: profile },
      });
    }

    if (QueryRevision != ProfileRevisionCheck) {
      ApplyProfileChanges = [
        {
          changeType: "fullProfileUpdate",
          profile: profile,
        },
      ];
    }

    res.json({
      profileRevision: profile.rvn || 0,
      profileId: req.query.profileId,
      profileChangesBaseRevision: BaseRevision,
      profileChanges: ApplyProfileChanges,
      profileCommandRevision: profile.commandRevision || 0,
      serverTime: new Date().toISOString(),
      responseVersion: 1,
    });
  },
);

router.post(
  "/fortnite/api/game/v2/profile/*/client/RefundMtxPurchase",
  verifyToken,
  async (req: Request, res: Response) => {
    const profiles = await Profile.findOne({ accountId: req.params[0] });
    let profile = profiles.profiles[req.query.profileId];
    let profile0 = profiles.profiles["profile0"];

    const ItemProfile = profiles.profiles.athena;
    const memory = functions.GetVersionInfo(req);

    let ApplyProfileChanges = [];
    let MultiUpdate = [];
    let BaseRevision = profile.rvn || 0;
    let QueryRevision = req.query.rvn || -1;
    let ProfileRevisionCheck =
      memory.build >= 12.2 ? profile.commandRevision : profile.rvn;
    let ItemGuids = [];

    if (req.body.purchaseId) {
      MultiUpdate.push({
        profileRevision: ItemProfile.rvn || 0,
        profileId: "athena",
        profileChangesBaseRevision: ItemProfile.rvn || 0,
        profileChanges: [],
        profileCommandRevision: ItemProfile.commandRevision || 0,
      });

      profile.stats.attributes.mtx_purchase_history.refundsUsed += 1;
      profile.stats.attributes.mtx_purchase_history.refundCredits -= 1;
      for (let i in profile.stats.attributes.mtx_purchase_history.purchases) {
        if (
          profile.stats.attributes.mtx_purchase_history.purchases[i]
            .purchaseId == req.body.purchaseId
        ) {
          for (let x in profile.stats.attributes.mtx_purchase_history.purchases[
            i
          ].lootResult) {
            ItemGuids.push(
              profile.stats.attributes.mtx_purchase_history.purchases[i]
                .lootResult[x].itemGuid,
            );
          }
          profile.stats.attributes.mtx_purchase_history.purchases[
            i
          ].refundDate = new Date().toISOString();
          for (let key in profile.items) {
            if (
              profile.items[key].templateId
                .toLowerCase()
                .startsWith("currency:mtx")
            ) {
              if (
                profile.items[key].attributes.platform.toLowerCase() ==
                  profile.stats.attributes.current_mtx_platform.toLowerCase() ||
                profile.items[key].attributes.platform.toLowerCase() == "shared"
              ) {
                profile.items[key].quantity +=
                  profile.stats.attributes.mtx_purchase_history.purchases[
                    i
                  ].totalMtxPaid;
                profile0.items[key].quantity +=
                  profile.stats.attributes.mtx_purchase_history.purchases[
                    i
                  ].totalMtxPaid;

                ApplyProfileChanges.push(
                  {
                    changeType: "itemQuantityChanged",
                    itemId: key,
                    quantity: profile.items[key].quantity,
                  },
                  {
                    changeType: "itemQuantityChanged",
                    itemId: key,
                    quantity: profile0.items[key].quantity,
                  },
                );

                break;
              }
            }
          }
        }
      }

      for (let i in ItemGuids) {
        try {
          delete ItemProfile.items[ItemGuids[i]];
          MultiUpdate[0].profileChanges.push({
            changeType: "itemRemoved",
            itemId: ItemGuids[i],
          });
        } catch (err) {}
      }
      ItemProfile.rvn += 1;
      ItemProfile.commandRevision += 1;
      profile.rvn += 1;
      profile.commandRevision += 1;
      profile0.rvn += 1;
      profile0.commandRevision += 1;
      StatChanged = true;
    }

    if (ApplyProfileChanges.length > 0) {
      ApplyProfileChanges.push({
        changeType: "statModified",
        name: "mtx_purchase_history",
        value: profile.stats.attributes.mtx_purchase_history,
      });
      MultiUpdate[0].profileRevision = ItemProfile.rvn || 0;
      MultiUpdate[0].profileCommandRevision = ItemProfile.commandRevision || 0;

      await profiles.updateOne({
        $set: {
          [`profiles.${req.query.profileId}`]: profile,
          [`profiles.profile0`]: profile0,
          [`profiles.athena`]: ItemProfile,
        },
      });
    }

    if (QueryRevision != ProfileRevisionCheck) {
      ApplyProfileChanges = [
        {
          changeType: "fullProfileUpdate",
          profile: profile,
        },
      ];
    }

    res.json({
      profileRevision: profile.rvn || 0,
      profileId: req.query.profileId,
      profileChangesBaseRevision: BaseRevision,
      profileChanges: ApplyProfileChanges,
      profileCommandRevision: profile.commandRevision || 0,
      serverTime: new Date().toISOString(),
      multiUpdate: MultiUpdate,
      responseVersion: 1,
    });
  },
);

router.post(
  "/fortnite/api/game/v2/profile/*/client/IncrementNamedCounterStat",
  async (req: Request, res: Response) => {
    const profiles = await Profile.findOne({ accountId: req.params[0] });
    let profile = profiles.profiles[req.query.profileId];

    let ApplyProfileChanges = [];
    let BaseRevision = profile.rvn || 0;
    let QueryRevision = req.query.rvn || -1;
    let StatChanged = false;

    if (
      req.body.counterName &&
      profile.stats.attributes.hasOwnProperty("named_counters")
    ) {
      if (
        profile.stats.attributes.named_counters.hasOwnProperty(
          req.body.counterName,
        )
      ) {
        profile.stats.attributes.named_counters[
          req.body.counterName
        ].current_count += 1;
        profile.stats.attributes.named_counters[
          req.body.counterName
        ].last_incremented_time = new Date().toISOString();

        StatChanged = true;
      }
    }

    if (StatChanged == true) {
      profile.rvn += 1;
      profile.commandRevision += 1;

      ApplyProfileChanges.push({
        changeType: "statModified",
        name: "named_counters",
        value: profile.stats.attributes.named_counters,
      });

      await profiles.updateOne({
        $set: { [`profiles.${req.query.profileId}`]: profile },
      });
    }

    if (QueryRevision != BaseRevision) {
      ApplyProfileChanges = [
        {
          changeType: "fullProfileUpdate",
          profile: profile,
        },
      ];
    }

    res.json({
      profileRevision: profile.rvn || 0,
      profileId: req.query.profileId,
      profileChangesBaseRevision: BaseRevision,
      profileChanges: ApplyProfileChanges,
      profileCommandRevision: profile.commandRevision || 0,
      serverTime: new Date().toISOString(),
      responseVersion: 1,
    });
  },
);

router.post(
  "/fortnite/api/game/v2/profile/*/client/PurchaseCatalogEntry",
  verifyToken,
  async (req: Request, res: Response) => {

    const profiles = await Profile.findOne({ accountId: req.user.accountId });

    if (
      !(await profileManager.validateProfile(req.query.profileId, profiles))
    ) {
      return error.createError(
        "errors.com.epicgames.modules.profiles.operation_forbidden",
        `Unable to find template configuration for profile ${req.query.profileId}`,
        [req.query.profileId],
        12813,
        undefined,
        403,
        res,
      );
    }

    let profile = profiles.profiles[req.query.profileId];
    let athena = profiles.profiles["athena"];
    let profile0 = profiles.profiles["profile0"];

    if (
      req.query.profileId != "common_core" &&
      req.query.profileId != "profile0"
    ) {
      return error.createError(
        "errors.com.epicgames.modules.profiles.invalid_command",
        `PurchaseCatalogEntry is not valid on ${req.query.profileId} profile`,
        ["PurchaseCatalogEntry", req.query.profileId],
        12801,
        undefined,
        400,
        res,
      );
    }

    let MultiUpdate = [
      {
        profileRevision: athena.rvn || 0,
        profileId: "athena",
        profileChangesBaseRevision: athena.rvn || 0,
        profileChanges: [],
        profileCommandRevision: athena.commandRevision || 0,
      },
    ];

    const memory = functions.GetVersionInfo(req);

    let Notifications = [];
    let ApplyProfileChanges = [];
    let BaseRevision = profile.rvn;
    let ProfileRevisionCheck =
      memory.build >= 12.2 ? profile.commandRevision : profile.rvn;
    let QueryRevision = req.query.rvn || -1;

    let missingFields = checkFields(["offerId"], req.body);

    if (missingFields.fields.length > 0) {
      return error.createError(
        "errors.com.epicgames.validation.validation_failed",
        `Validation Failed. [${missingFields.fields.join(", ")}] field(s) is missing.`,
        [`[${missingFields.fields.join(", ")}]`],
        1040,
        undefined,
        400,
        res,
      );
    }

    if (typeof req.body.offerId != "string") {
      return ValidationError("offerId", "a string", res);
    }
    if (typeof req.body.purchaseQuantity != "number") {
      return ValidationError("purchaseQuantity", "a number", res);
    }
    if (req.body.purchaseQuantity < 1) {
      return error.createError(
        "errors.com.epicgames.validation.validation_failed",
        `Validation Failed. 'purchaseQuantity' is less than 1.`,
        ["purchaseQuantity"],
        1040,
        undefined,
        400,
        res,
      );
    }

    if (!profile.items) profile.items = {};
    if (!athena.items) athena.items = {};
    if (!profile0.items) profile0.items = {};

    let findOfferId = functions.getOfferID(req.body.offerId);

    const bpSeason = memory.season;
    const bpFilePath = path.join(__dirname, "../../../Base/responses/Athena/BattlePass/", `Season${bpSeason}.json`);
    let BattlePassEarly: any = null;
    try {
      if (fs.existsSync(bpFilePath)) BattlePassEarly = JSON.parse(fs.readFileSync(bpFilePath, "utf8"));
    } catch {}

    const isBattlePassOffer = BattlePassEarly && (
      req.body.offerId == BattlePassEarly.battlePassOfferId ||
      req.body.offerId == BattlePassEarly.battleBundleOfferId ||
      req.body.offerId == BattlePassEarly.tierOfferId
    );

    console.log(`[PURCHASE] offerId=${req.body.offerId} season=${bpSeason} isBP=${isBattlePassOffer} BPLoaded=${!!BattlePassEarly}`);

    if (!findOfferId && !isBattlePassOffer) {
      return error.createError(
        "errors.com.epicgames.fortnite.id_invalid",
        `Offer ID (id: '${req.body.offerId}') not found`,
        [req.body.offerId],
        16027,
        undefined,
        400,
        res,
      );
    }

    if (isBattlePassOffer && !findOfferId) {
      const bpPrices: Record<string, number> = {
        [BattlePassEarly.battlePassOfferId]: 0,
        [BattlePassEarly.battleBundleOfferId]: 0,
        [BattlePassEarly.tierOfferId]: 0,
      };
      findOfferId = {
        name: 'BRSeasonStorefront',
        offerId: {
          prices: [{ currencyType: 'MtxCurrency', finalPrice: 0 }],
          itemGrants: [],
        },
      };
    }

    // If this is a BP offer, handle it directly here and return
    if (isBattlePassOffer) {
      const bp = BattlePassEarly;
      const offerId = req.body.offerId;
      const isPass = offerId === bp.battlePassOfferId;
      const isBundle = offerId === bp.battleBundleOfferId;
      const isTier = offerId === bp.tierOfferId;
      
      // Check if already owns Battle Pass (for pass/bundle purchases only)
      if ((isPass || isBundle) && athena.stats.attributes.book_purchased === true) {
        console.log(`[PURCHASE] User ${req.user.accountId} already owns Battle Pass (book_purchased=${athena.stats.attributes.book_purchased}), rejecting duplicate purchase`);
        return error.createError(
          "errors.com.epicgames.fortnite.already_owned",
          "You already own the Battle Pass.",
          [],
          16029,
          undefined,
          400,
          res,
        );
      }

      console.log(`[PURCHASE] book_purchased BEFORE purchase: ${athena.stats.attributes.book_purchased}, book_level: ${athena.stats.attributes.book_level}`);

      // Acquire lock to prevent duplicate purchases from spam clicking
      if (!acquirePurchaseLock(req.user.accountId, req.body.offerId)) {
        console.log(`[PURCHASE] Blocked duplicate Battle Pass purchase attempt for ${req.user.accountId}`);
        return error.createError(
          "errors.com.epicgames.fortnite.purchase_in_progress",
          "A purchase is already in progress. Please wait.",
          [],
          16028,
          undefined,
          409,
          res,
        );
      }

      try {
        const purchaseQuantity = req.body.purchaseQuantity || 1;
        const OnlySeasonNumber = `${memory.season}`;

        // Determine which tiers to grant based on purchase type
        let startTier: number;
        let EndingTier: number;
        
        if (isPass) {
          // Regular Battle Pass: Only grant tier 0 rewards (starter items)
          startTier = 0;
          EndingTier = 1;
        } else if (isBundle) {
          // Battle Bundle: Grant tier 0 + next 25 tiers
          startTier = 0;
          EndingTier = Math.min(100, 26); // Tier 0-25 = 26 tiers
          athena.stats.attributes.book_level = EndingTier;
        } else if (isTier) {
          // Tier purchase: Grant next X tiers from current level
          startTier = athena.stats.attributes.book_level || 1;
          EndingTier = Math.min(100, startTier + purchaseQuantity);
          athena.stats.attributes.book_level = EndingTier;
        } else {
          startTier = 0;
          EndingTier = 1;
        }

        // Mark as purchased FIRST
        if (isPass || isBundle) {
          athena.stats.attributes.book_purchased = true;
        }

        // Add the Battle Pass token to both common_core and athena profiles
        const tokenTemplateId = `Token:athena_s${OnlySeasonNumber}_nobattlebundleoption_token`;
        const existingTokenInProfile = Object.values(profile.items).find((item: any) => item.templateId === tokenTemplateId);
        const existingTokenInAthena = Object.values(athena.items).find((item: any) => item.templateId === tokenTemplateId);
        
        if (!existingTokenInProfile && (isPass || isBundle)) {
          const tokenKey = functions.MakeID();
          const tokenData = {
            templateId: tokenTemplateId,
            attributes: { max_level_bonus: 0, level: 1, item_seen: true, xp: 0, favorite: false },
            quantity: 1,
          };
          profile.items[tokenKey] = tokenData;
          ApplyProfileChanges.push({ changeType: 'itemAdded', itemId: tokenKey, item: tokenData });
        }
        
        // Also add to athena profile so the client shows the yellow flag
        if (!existingTokenInAthena && (isPass || isBundle)) {
          const athenaTokenKey = functions.MakeID();
          const athenaTokenData = {
            templateId: tokenTemplateId,
            attributes: { max_level_bonus: 0, level: 1, item_seen: false, xp: 0, favorite: false },
            quantity: 1,
          };
          athena.items[athenaTokenKey] = athenaTokenData;
          (MultiUpdate[0].profileChanges as any[]).push({ changeType: 'itemAdded', itemId: athenaTokenKey, item: athenaTokenData });
        }

        console.log(`[PURCHASE] Granting rewards from tier ${startTier} to ${EndingTier}, isPass=${isPass}, isBundle=${isBundle}, isTier=${isTier}`);

      // Add book_purchased and book_level to MultiUpdate so client sees the changes
      MultiUpdate[0].profileChanges.push({
        changeType: "statModified",
        name: "book_purchased",
        value: athena.stats.attributes.book_purchased,
      });
      MultiUpdate[0].profileChanges.push({
        changeType: "statModified",
        name: "book_level",
        value: athena.stats.attributes.book_level,
      });

      MultiUpdate[0].profileChanges.push({
        changeType: "statModified",
        name: "book_purchased",
        value: true,
      });
      MultiUpdate[0].profileChanges.push({
        changeType: "statModified",
        name: "book_level",
        value: athena.stats.attributes.book_level,
      });

      // Only grant rewards for tiers we haven't already granted (startTier → EndingTier)
      for (let i = startTier; i < EndingTier; i++) {
        const FreeTier = bp.freeRewards?.[i] || {};
        const PaidTier = bp.paidRewards?.[i] || {};
        for (const [item, qty] of [...Object.entries(FreeTier), ...Object.entries(PaidTier)] as [string, number][]) {
          if (item.toLowerCase().startsWith('currency:')) continue;
          if (item.toLowerCase() === 'token:athenaseasonxpboost') { 
            athena.stats.attributes.season_match_boost = (athena.stats.attributes.season_match_boost || 0) + qty; 
            continue; 
          }
          if (item.toLowerCase() === 'token:athenaseasonfriendxpboost') { 
            athena.stats.attributes.season_friend_match_boost = (athena.stats.attributes.season_friend_match_boost || 0) + qty; 
            continue; 
          }
          
          // Check if item already exists in athena profile
          const existingItemId = Object.keys(athena.items).find(key => athena.items[key].templateId === item);
          
          if (existingItemId) {
            // Item exists, just increment quantity
            athena.items[existingItemId].quantity = (athena.items[existingItemId].quantity || 1) + qty;
            athena.items[existingItemId].attributes.item_seen = false;
            (MultiUpdate[0].profileChanges as any[]).push({ 
              changeType: 'itemQuantityChanged', 
              itemId: existingItemId, 
              quantity: athena.items[existingItemId].quantity 
            });
          } else {
            // New item, add it with variants array
            const id = functions.MakeID();
            const newItem = { 
              templateId: item, 
              attributes: { 
                max_level_bonus: 0, 
                level: 1, 
                item_seen: false, 
                xp: 0, 
                variants: [],  // CRITICAL: Must have variants array for skins with styles
                favorite: false 
              }, 
              quantity: qty 
            };
            athena.items[id] = newItem;
            (MultiUpdate[0].profileChanges as any[]).push({ changeType: 'itemAdded', itemId: id, item: newItem });
          }
        }
      }

      athena.stats.attributes.book_purchased = true;
      athena.rvn += 1;
      athena.commandRevision += 1;
      profile.rvn += 1;
      profile.commandRevision += 1;
      profile.updated = new Date().toISOString();

      // Update MultiUpdate with the NEW revision numbers AFTER incrementing
      MultiUpdate[0].profileRevision = athena.rvn;
      MultiUpdate[0].profileCommandRevision = athena.commandRevision;

      console.log(`[PURCHASE] book_purchased AFTER purchase: ${athena.stats.attributes.book_purchased}, book_level: ${athena.stats.attributes.book_level}`);
      console.log(`[PURCHASE] Saving to database...`);

      await profiles.updateOne({
        $set: {
          [`profiles.${req.query.profileId}`]: profile,
          'profiles.athena': athena,
        },
      });

      console.log(`[PURCHASE] Database save complete`);

      // Build loot list for the Battle Pass purchase screen
      const lootList = [];
      
      // Add the Battle Pass token to the loot list so the client shows the BP purchase screen
      if (isPass || isBundle) {
        const tokenTemplateId = `Token:athena_s${OnlySeasonNumber}_nobattlebundleoption_token`;
        lootList.push({ itemType: tokenTemplateId, itemGuid: tokenTemplateId, itemProfile: 'common_core', quantity: 1 });
      }
      
      for (let i = startTier; i < EndingTier; i++) {
        const FreeTier = bp.freeRewards?.[i] || {};
        const PaidTier = bp.paidRewards?.[i] || {};
        for (const [item, qty] of [...Object.entries(FreeTier), ...Object.entries(PaidTier)] as [string, number][]) {
          if (!item.toLowerCase().startsWith('currency:')) {
            lootList.push({ itemType: item, itemGuid: item, itemProfile: 'athena', quantity: qty });
          }
        }
      }

      console.log(`[PURCHASE] Battle Pass purchase complete. Granted ${lootList.length} items from tiers ${startTier} to ${EndingTier}`);

      // Create gift box in common_core profile for purchase confirmation screens
      const giftBoxId = functions.MakeID();
      const giftBoxTemplateId = isBundle ? "GiftBox:gb_battlepasspurchased" : isTier ? "GiftBox:gb_battlepass" : "GiftBox:gb_battlepasspurchased";
      
      const giftBox = {
        templateId: giftBoxTemplateId,
        attributes: {
          max_level_bonus: 0,
          fromAccountId: "",
          lootList: lootList,
          level: 1,
          item_seen: false,
          xp: 0,
          favorite: false,
        },
        quantity: 1,
      };
      
      profile.items[giftBoxId] = giftBox;
      ApplyProfileChanges.push({
        changeType: "itemAdded",
        itemId: giftBoxId,
        item: giftBox,
      });
      
      console.log(`[GIFT BOX] Created gift box ${giftBoxId} with template ${giftBoxTemplateId} containing ${lootList.length} items`);
      console.log(`[GIFT BOX] Gift box lootList:`, JSON.stringify(lootList, null, 2));

      // Save the updated profile with gift box to database
      await profiles.updateOne({
        $set: {
          [`profiles.${req.query.profileId}`]: profile,
        },
      });

      console.log(`[GIFT BOX] Gift box saved to database in common_core profile`);

        return res.json({
          profileRevision: profile.rvn || 0,
          profileId: req.query.profileId,
          profileChangesBaseRevision: BaseRevision,
          profileChanges: ApplyProfileChanges,
          notifications: [{
            type: 'CatalogPurchase',
            primary: true,
            lootResult: {
              items: lootList
            }
          }],
          profileCommandRevision: profile.commandRevision || 0,
          serverTime: new Date().toISOString(),
          multiUpdate: MultiUpdate,
          responseVersion: 1,
        });
      } finally {
        // Always release the lock, even if an error occurred
        releasePurchaseLock(req.user.accountId, req.body.offerId);
      }
    }

    {
      let playerSeason = memory.season;
      let season = `Season${playerSeason}`;
      let OnlySeasonNumber = `${playerSeason}`;
      let battlePassFilePath = path.join(
        __dirname,
        "../../../Base/responses/Athena/BattlePass/",
        `${season}.json`,
      );
      let BattlePass = null;
      let ItemExists = false;

      try {
        if (fs.existsSync(battlePassFilePath)) {
          BattlePass = JSON.parse(fs.readFileSync(battlePassFilePath, "utf8"));
        }
      } catch (e) {
      }

      if (BattlePass) {
        if (
          req.body.offerId == BattlePass.battlePassOfferId ||
          req.body.offerId == BattlePass.battleBundleOfferId ||
          req.body.offerId == BattlePass.tierOfferId
        ) {
          let offerId = req.body.offerId;
          let purchaseQuantity = req.body.purchaseQuantity || 1;
          let totalPrice = 0; // Always free

          if (
            req.body.offerId == BattlePass.battlePassOfferId ||
            req.body.offerId == BattlePass.battleBundleOfferId ||
            req.body.offerId == BattlePass.tierOfferId
          ) {
            // Skip V-Bucks check — battle pass is free
          }

          if (
            BattlePass.battlePassOfferId == offerId ||
            BattlePass.battleBundleOfferId == offerId
          ) {
            let lootList = [];
            let EndingTier = athena.stats.attributes.book_level;
            athena.stats.attributes.book_purchased = true;

            await profiles?.updateOne({
              $set: { 'profiles.athena.stats.attributes.book_purchased': true }
            });

            const tokenKey = `Token:Athena_S${OnlySeasonNumber}_NoBattleBundleOption_Token`;
            const tokenData = {
              templateId: `Token:athena_s${OnlySeasonNumber}_nobattlebundleoption_token`,
              attributes: {
                max_level_bonus: 0,
                level: 1,
                item_seen: true,
                xp: 0,
                favorite: false,
              },
              quantity: 1,
            };

            profiles.profiles["common_core"].items[tokenKey] = tokenData;

            ApplyProfileChanges.push({
              changeType: "itemAdded",
              itemId: tokenKey,
              item: tokenData,
            });

            if (BattlePass.battleBundleOfferId == offerId) {
              athena.stats.attributes.book_level += 25;
              if (athena.stats.attributes.book_level > 100)
                athena.stats.attributes.book_level = 100;
              EndingTier = athena.stats.attributes.book_level;
            }
            for (let i = 0; i < EndingTier; i++) {
              let FreeTier = BattlePass.freeRewards[i] || {};
              let PaidTier = BattlePass.paidRewards[i] || {};
              for (let item in FreeTier) {
                if (item.toLowerCase() == "token:athenaseasonxpboost") {
                  athena.stats.attributes.season_match_boost += FreeTier[item];
                  MultiUpdate[0].profileChanges.push({
                    changeType: "statModified",
                    name: "season_match_boost",
                    value: athena.stats.attributes.season_match_boost,
                  });
                }
                if (item.toLowerCase() == "token:athenaseasonfriendxpboost") {
                  athena.stats.attributes.season_friend_match_boost +=
                    FreeTier[item];
                  MultiUpdate[0].profileChanges.push({
                    changeType: "statModified",
                    name: "season_friend_match_boost",
                    value: athena.stats.attributes.season_friend_match_boost,
                  });
                }
                if (item.toLowerCase().startsWith("token:") && item.toLowerCase() !== "token:athenaseasonxpboost" && item.toLowerCase() !== "token:athenaseasonfriendxpboost") {
                  const tokenId = functions.MakeID();
                  const tokenItem = { templateId: item, attributes: { max_level_bonus: 0, level: 1, item_seen: false, xp: 0, favorite: false }, quantity: FreeTier[item] };
                  athena.items[tokenId] = tokenItem;
                  MultiUpdate[0].profileChanges.push({ changeType: "itemAdded", itemId: tokenId, item: tokenItem });
                }
                if (item.toLowerCase().startsWith("currency:mtx")) {
                  for (let key in profile.items) {
                    if (
                      profile.items[key].templateId
                        .toLowerCase()
                        .startsWith("currency:mtx")
                    ) {
                      if (
                        profile.items[key].attributes.platform.toLowerCase() ==
                          profile.stats.attributes.current_mtx_platform.toLowerCase() ||
                        profile.items[key].attributes.platform.toLowerCase() ==
                          "shared"
                      ) {
                        profile.items[key].attributes.quantity +=
                          FreeTier[item];
                        break;
                      }
                    }
                  }
                }
                if (item.toLowerCase().startsWith("homebasebanner")) {
                  for (let key in profile.items) {
                    if (
                      profile.items[key].templateId.toLowerCase() ==
                      item.toLowerCase()
                    ) {
                      profile.items[key].attributes.item_seen = false;
                      ItemExists = true;
                      ApplyProfileChanges.push({
                        changeType: "itemAttrChanged",
                        itemId: key,
                        attributeName: "item_seen",
                        attributeValue: profile.items[key].attributes.item_seen,
                      });
                    }
                  }
                  if (ItemExists == false) {
                    let ItemID = functions.MakeID();
                    let Item = {
                      templateId: item,
                      attributes: { item_seen: false },
                      quantity: 1,
                    };
                    profile.items[ItemID] = Item;
                    ApplyProfileChanges.push({
                      changeType: "itemAdded",
                      itemId: ItemID,
                      item: Item,
                    });
                  }
                  ItemExists = false;
                }
                if (item.toLowerCase().startsWith("athena")) {
                  for (let key in athena.items) {
                    if (
                      athena.items[key].templateId.toLowerCase() ==
                      item.toLowerCase()
                    ) {
                      athena.items[key].attributes.item_seen = false;
                      ItemExists = true;
                      MultiUpdate[0].profileChanges.push({
                        changeType: "itemAttrChanged",
                        itemId: key,
                        attributeName: "item_seen",
                        attributeValue: athena.items[key].attributes.item_seen,
                      });
                    }
                  }
                  if (ItemExists == false) {
                    let ItemID = functions.MakeID();
                    const Item = {
                      templateId: item,
                      attributes: {
                        max_level_bonus: 0,
                        level: 1,
                        item_seen: false,
                        xp: 0,
                        variants: [],
                        favorite: false,
                      },
                      quantity: FreeTier[item],
                    };
                    athena.items[ItemID] = Item;
                    MultiUpdate[0].profileChanges.push({
                      changeType: "itemAdded",
                      itemId: ItemID,
                      item: Item,
                    });
                  }
                  ItemExists = false;
                }
                lootList.push({
                  itemType: item,
                  itemGuid: item,
                  quantity: FreeTier[item],
                });
              }
              for (let item in PaidTier) {
                if (item.toLowerCase() == "token:athenaseasonxpboost") {
                  athena.stats.attributes.season_match_boost += PaidTier[item];
                  MultiUpdate[0].profileChanges.push({
                    changeType: "statModified",
                    name: "season_match_boost",
                    value: athena.stats.attributes.season_match_boost,
                  });
                }
                if (item.toLowerCase() == "token:athenaseasonfriendxpboost") {
                  athena.stats.attributes.season_friend_match_boost +=
                    PaidTier[item];
                  MultiUpdate[0].profileChanges.push({
                    changeType: "statModified",
                    name: "season_friend_match_boost",
                    value: athena.stats.attributes.season_friend_match_boost,
                  });
                }
                if (item.toLowerCase().startsWith("token:") && item.toLowerCase() !== "token:athenaseasonxpboost" && item.toLowerCase() !== "token:athenaseasonfriendxpboost") {
                  const tokenId = functions.MakeID();
                  const tokenItem = { templateId: item, attributes: { max_level_bonus: 0, level: 1, item_seen: false, xp: 0, favorite: false }, quantity: PaidTier[item] };
                  athena.items[tokenId] = tokenItem;
                  MultiUpdate[0].profileChanges.push({ changeType: "itemAdded", itemId: tokenId, item: tokenItem });
                }
                if (item.toLowerCase().startsWith("currency:mtx")) {
                  for (let key in profile.items) {
                    if (
                      profile.items[key].templateId
                        .toLowerCase()
                        .startsWith("currency:mtx")
                    ) {
                      if (
                        profile.items[key].attributes.platform.toLowerCase() ==
                          profile.stats.attributes.current_mtx_platform.toLowerCase() ||
                        profile.items[key].attributes.platform.toLowerCase() ==
                          "shared"
                      ) {
                        profile.items[key].quantity += PaidTier[item];
                        profile0.items[key].quantity += PaidTier[item];
                        break;
                      }
                    }
                  }
                }
                if (item.toLowerCase().startsWith("homebasebanner")) {
                  for (let key in profile.items) {
                    if (
                      profile.items[key].templateId.toLowerCase() ==
                      item.toLowerCase()
                    ) {
                      profile.items[key].attributes.item_seen = false;
                      ItemExists = true;
                      ApplyProfileChanges.push({
                        changeType: "itemAttrChanged",
                        itemId: key,
                        attributeName: "item_seen",
                        attributeValue: profile.items[key].attributes.item_seen,
                      });
                    }
                  }
                  if (ItemExists == false) {
                    let ItemID = functions.MakeID();
                    let Item = {
                      templateId: item,
                      attributes: { item_seen: false },
                      quantity: 1,
                    };
                    profile.items[ItemID] = Item;
                    ApplyProfileChanges.push({
                      changeType: "itemAdded",
                      itemId: ItemID,
                      item: Item,
                    });
                  }
                  ItemExists = false;
                }
                if (item.toLowerCase().startsWith("athena")) {
                  for (let key in athena.items) {
                    if (
                      athena.items[key].templateId.toLowerCase() ==
                      item.toLowerCase()
                    ) {
                      athena.items[key].attributes.item_seen = false;
                      ItemExists = true;
                      MultiUpdate[0].profileChanges.push({
                        changeType: "itemAttrChanged",
                        itemId: key,
                        attributeName: "item_seen",
                        attributeValue: athena.items[key].attributes.item_seen,
                      });
                    }
                  }
                  if (ItemExists == false) {
                    let ItemID = functions.MakeID();
                    const Item = {
                      templateId: item,
                      attributes: {
                        max_level_bonus: 0,
                        level: 1,
                        item_seen: false,
                        xp: 0,
                        variants: [],
                        favorite: false,
                      },
                      quantity: PaidTier[item],
                    };
                    athena.items[ItemID] = Item;
                    MultiUpdate[0].profileChanges.push({
                      changeType: "itemAdded",
                      itemId: ItemID,
                      item: Item,
                    });
                  }
                  ItemExists = false;
                }
                lootList.push({
                  itemType: item,
                  itemGuid: item,
                  quantity: PaidTier[item],
                });
              }
            }
            let GiftBoxID = functions.MakeID();
            let GiftBox = {
              templateId:
                8 <= 4
                  ? "GiftBox:gb_battlepass"
                  : "GiftBox:gb_battlepasspurchased",
              attributes: {
                max_level_bonus: 0,
                fromAccountId: "",
                lootList: lootList,
              },
            };
            if (8 > 2) {
              profile.items[GiftBoxID] = GiftBox;
              ApplyProfileChanges.push({
                changeType: "itemAdded",
                itemId: GiftBoxID,
                item: GiftBox,
              });
            }
            MultiUpdate[0].profileChanges.push({
              changeType: "statModified",
              name: "book_purchased",
              value: athena.stats.attributes.book_purchased,
            });
            MultiUpdate[0].profileChanges.push({
              changeType: "statModified",
              name: "book_level",
              value: athena.stats.attributes.book_level,
            });
          }

          if (BattlePass.tierOfferId == offerId) {
            let lootList = [];
            let StartingTier = athena.stats.attributes.book_level;
            let EndingTier;
            athena.stats.attributes.book_level +=
              req.body.purchaseQuantity || 1;
            if (athena.stats.attributes.book_level > 100)
              athena.stats.attributes.book_level = 100;
            EndingTier = athena.stats.attributes.book_level;
            for (let i = StartingTier; i < EndingTier; i++) {
              let FreeTier = BattlePass.freeRewards[i] || {};
              let PaidTier = BattlePass.paidRewards[i] || {};
              for (let item in FreeTier) {
                if (item.toLowerCase() == "token:athenaseasonxpboost") {
                  athena.stats.attributes.season_match_boost += FreeTier[item];
                  MultiUpdate[0].profileChanges.push({
                    changeType: "statModified",
                    name: "season_match_boost",
                    value: athena.stats.attributes.season_match_boost,
                  });
                }
                if (item.toLowerCase() == "token:athenaseasonfriendxpboost") {
                  athena.stats.attributes.season_friend_match_boost +=
                    FreeTier[item];
                  MultiUpdate[0].profileChanges.push({
                    changeType: "statModified",
                    name: "season_friend_match_boost",
                    value: athena.stats.attributes.season_friend_match_boost,
                  });
                }
                if (item.toLowerCase().startsWith("token:") && item.toLowerCase() !== "token:athenaseasonxpboost" && item.toLowerCase() !== "token:athenaseasonfriendxpboost") {
                  const tokenId = functions.MakeID();
                  const tokenItem = { templateId: item, attributes: { max_level_bonus: 0, level: 1, item_seen: false, xp: 0, favorite: false }, quantity: FreeTier[item] };
                  athena.items[tokenId] = tokenItem;
                  MultiUpdate[0].profileChanges.push({ changeType: "itemAdded", itemId: tokenId, item: tokenItem });
                }
                if (item.toLowerCase().startsWith("currency:mtx")) {
                  for (let key in profile.items) {
                    if (
                      profile.items[key].templateId
                        .toLowerCase()
                        .startsWith("currency:mtx")
                    ) {
                      if (
                        profile.items[key].attributes.platform.toLowerCase() ==
                          profile.stats.attributes.current_mtx_platform.toLowerCase() ||
                        profile.items[key].attributes.platform.toLowerCase() ==
                          "shared"
                      ) {
                        profile.items[key].quantity += FreeTier[item];
                        profile0.items[key].quantity += PaidTier[item];
                        break;
                      }
                    }
                  }
                }
                if (item.toLowerCase().startsWith("homebasebanner")) {
                  for (let key in profile.items) {
                    if (
                      profile.items[key].templateId.toLowerCase() ==
                      item.toLowerCase()
                    ) {
                      profile.items[key].attributes.item_seen = false;
                      ItemExists = true;
                      ApplyProfileChanges.push({
                        changeType: "itemAttrChanged",
                        itemId: key,
                        attributeName: "item_seen",
                        attributeValue: profile.items[key].attributes.item_seen,
                      });
                    }
                  }
                  if (ItemExists == false) {
                    let ItemID = functions.MakeID();
                    let Item = {
                      templateId: item,
                      attributes: { item_seen: false },
                      quantity: 1,
                    };
                    profile.items[ItemID] = Item;
                    ApplyProfileChanges.push({
                      changeType: "itemAdded",
                      itemId: ItemID,
                      item: Item,
                    });
                  }
                  ItemExists = false;
                }
                if (item.toLowerCase().startsWith("athena")) {
                  for (let key in athena.items) {
                    if (
                      athena.items[key].templateId.toLowerCase() ==
                      item.toLowerCase()
                    ) {
                      athena.items[key].attributes.item_seen = false;
                      ItemExists = true;
                      MultiUpdate[0].profileChanges.push({
                        changeType: "itemAttrChanged",
                        itemId: key,
                        attributeName: "item_seen",
                        attributeValue: athena.items[key].attributes.item_seen,
                      });
                    }
                  }
                  if (ItemExists == false) {
                    let ItemID = functions.MakeID();
                    const Item = {
                      templateId: item,
                      attributes: {
                        max_level_bonus: 0,
                        level: 1,
                        item_seen: false,
                        xp: 0,
                        variants: [],
                        favorite: false,
                      },
                      quantity: FreeTier[item],
                    };
                    athena.items[ItemID] = Item;
                    MultiUpdate[0].profileChanges.push({
                      changeType: "itemAdded",
                      itemId: ItemID,
                      item: Item,
                    });
                  }
                  ItemExists = false;
                }
                lootList.push({
                  itemType: item,
                  itemGuid: item,
                  quantity: FreeTier[item],
                });
              }
              for (let item in PaidTier) {
                if (item.toLowerCase() == "token:athenaseasonxpboost") {
                  athena.stats.attributes.season_match_boost += PaidTier[item];
                  MultiUpdate[0].profileChanges.push({
                    changeType: "statModified",
                    name: "season_match_boost",
                    value: athena.stats.attributes.season_match_boost,
                  });
                }
                if (item.toLowerCase() == "token:athenaseasonfriendxpboost") {
                  athena.stats.attributes.season_friend_match_boost +=
                    PaidTier[item];
                  MultiUpdate[0].profileChanges.push({
                    changeType: "statModified",
                    name: "season_friend_match_boost",
                    value: athena.stats.attributes.season_friend_match_boost,
                  });
                }
                if (item.toLowerCase().startsWith("token:") && item.toLowerCase() !== "token:athenaseasonxpboost" && item.toLowerCase() !== "token:athenaseasonfriendxpboost") {
                  const tokenId = functions.MakeID();
                  const tokenItem = { templateId: item, attributes: { max_level_bonus: 0, level: 1, item_seen: false, xp: 0, favorite: false }, quantity: PaidTier[item] };
                  athena.items[tokenId] = tokenItem;
                  MultiUpdate[0].profileChanges.push({ changeType: "itemAdded", itemId: tokenId, item: tokenItem });
                }
                if (item.toLowerCase().startsWith("currency:mtx")) {
                  for (let key in profile.items) {
                    if (
                      profile.items[key].templateId
                        .toLowerCase()
                        .startsWith("currency:mtx")
                    ) {
                      if (
                        profile.items[key].attributes.platform.toLowerCase() ==
                          profile.stats.attributes.current_mtx_platform.toLowerCase() ||
                        profile.items[key].attributes.platform.toLowerCase() ==
                          "shared"
                      ) {
                        profile.items[key].quantity += PaidTier[item];
                        profile0.items[key].quantity += PaidTier[item];
                        break;
                      }
                    }
                  }
                }
                if (item.toLowerCase().startsWith("homebasebanner")) {
                  for (let key in profile.items) {
                    if (
                      profile.items[key].templateId.toLowerCase() ==
                      item.toLowerCase()
                    ) {
                      profile.items[key].attributes.item_seen = false;
                      ItemExists = true;
                      ApplyProfileChanges.push({
                        changeType: "itemAttrChanged",
                        itemId: key,
                        attributeName: "item_seen",
                        attributeValue: profile.items[key].attributes.item_seen,
                      });
                    }
                  }
                  if (ItemExists == false) {
                    let ItemID = functions.MakeID();
                    let Item = {
                      templateId: item,
                      attributes: { item_seen: false },
                      quantity: 1,
                    };
                    profile.items[ItemID] = Item;
                    ApplyProfileChanges.push({
                      changeType: "itemAdded",
                      itemId: ItemID,
                      item: Item,
                    });
                  }
                  ItemExists = false;
                }
                if (item.toLowerCase().startsWith("athena")) {
                  for (let key in athena.items) {
                    if (
                      athena.items[key].templateId.toLowerCase() ==
                      item.toLowerCase()
                    ) {
                      athena.items[key].attributes.item_seen = false;
                      ItemExists = true;
                      MultiUpdate[0].profileChanges.push({
                        changeType: "itemAttrChanged",
                        itemId: key,
                        attributeName: "item_seen",
                        attributeValue: athena.items[key].attributes.item_seen,
                      });
                    }
                  }
                  if (ItemExists == false) {
                    let ItemID = functions.MakeID();
                    const Item = {
                      templateId: item,
                      attributes: {
                        max_level_bonus: 0,
                        level: 1,
                        item_seen: false,
                        xp: 0,
                        variants: [],
                        favorite: false,
                      },
                      quantity: PaidTier[item],
                    };
                    athena.items[ItemID] = Item;
                    MultiUpdate[0].profileChanges.push({
                      changeType: "itemAdded",
                      itemId: ItemID,
                      item: Item,
                    });
                  }
                  ItemExists = false;
                }
                lootList.push({
                  itemType: item,
                  itemGuid: item,
                  quantity: PaidTier[item],
                });
              }
            }
            let GiftBoxID = functions.MakeID();
            let GiftBox = {
              templateId: "GiftBox:gb_battlepass",
              attributes: {
                max_level_bonus: 0,
                fromAccountId: "",
                lootList: lootList,
              },
            };
            if (8 > 2) {
              profile.items[GiftBoxID] = GiftBox;
              ApplyProfileChanges.push({
                changeType: "itemAdded",
                itemId: GiftBoxID,
                item: GiftBox,
              });
            }
            MultiUpdate[0].profileChanges.push({
              changeType: "statModified",
              name: "book_level",
              value: athena.stats.attributes.book_level,
            });
          }

          if (MultiUpdate[0].profileChanges.length > 0) {
            athena.rvn += 1;
            athena.commandRevision += 1;
            athena.updated = new Date().toISOString();
            MultiUpdate[0].profileRevision = athena.rvn;
            MultiUpdate[0].profileCommandRevision = athena.commandRevision;
          }

          if (ApplyProfileChanges.length > 0) {
            profile.rvn += 1;
            profile.commandRevision += 1;
            profile.updated = new Date().toISOString();
          }

          athena.rvn += 1;
          athena.commandRevision += 1;
          athena.updated = new Date().toISOString();

          await profiles?.updateOne({
            $set: {
              [`profiles.${req.query.profileId}`]: profile,
              [`profiles.athena`]: athena,
              [`profiles.profile0`]: profile0,
            },
          });

          if (QueryRevision != ProfileRevisionCheck) {
            ApplyProfileChanges = [
              {
                changeType: "fullProfileUpdate",
                profile: profile,
              },
            ];
          }

          res.json({
            profileRevision: profile.rvn || 0,
            profileId: req.query.profileId,
            profileChangesBaseRevision: BaseRevision,
            profileChanges: ApplyProfileChanges,
            notifications: Notifications,
            profileCommandRevision: profile.commandRevision || 0,
            serverTime: new Date().toISOString(),
            multiUpdate: MultiUpdate,
            responseVersion: 1,
          });

          return;
        }
      }
    }

    switch (true) {
      case /^BR(Daily|Weekly|Season)Storefront$/.test(findOfferId.name):
        Notifications.push({
          type: "CatalogPurchase",
          primary: true,
          lootResult: {
            items: [],
          },
        });

        for (let value of findOfferId.offerId.itemGrants) {
          const ID = functions.MakeID();
          const templateLower = value.templateId.toLowerCase();

          if (
            templateLower.startsWith("athena") ||
            templateLower.startsWith("token:") ||
            templateLower.startsWith("challengebundleschedule:")
          ) {
            for (let itemId in athena.items) {
              if (templateLower == athena.items[itemId].templateId.toLowerCase()) {
                return error.createError(
                  "errors.com.epicgames.offer.already_owned",
                  `You have already bought this item before.`,
                  undefined, 1040, undefined, 400, res,
                );
              }
            }

            const Item = {
              templateId: value.templateId,
              attributes: { item_seen: false, variants: [], max_level_bonus: 0, level: 1, xp: 0, favorite: false },
              quantity: value.quantity || 1,
            };

            athena.items[ID] = Item;
            MultiUpdate[0].profileChanges.push({ changeType: "itemAdded", itemId: ID, item: Item });
            Notifications[0].lootResult.items.push({ itemType: Item.templateId, itemGuid: ID, itemProfile: "athena", quantity: Item.quantity });

          } else if (templateLower.startsWith("homebasebanner")) {
            const Item = {
              templateId: value.templateId,
              attributes: { item_seen: false },
              quantity: 1,
            };
            profile.items[ID] = Item;
            ApplyProfileChanges.push({ changeType: "itemAdded", itemId: ID, item: Item });
            Notifications[0].lootResult.items.push({ itemType: Item.templateId, itemGuid: ID, itemProfile: "common_core", quantity: 1 });

          } else if (templateLower.startsWith("currency:mtx")) {
            for (let key in profile.items) {
              if (!profile.items[key].templateId.toLowerCase().startsWith("currency:mtx")) continue;
              const platform = profile.items[key].attributes?.platform?.toLowerCase();
              if (platform == profile.stats.attributes.current_mtx_platform?.toLowerCase() || platform == "shared") {
                profile.items[key].quantity += value.quantity || 1;
                ApplyProfileChanges.push({ changeType: "itemQuantityChanged", itemId: key, quantity: profile.items[key].quantity });
                Notifications[0].lootResult.items.push({ itemType: value.templateId, itemGuid: key, itemProfile: "common_core", quantity: value.quantity || 1 });
                break;
              }
            }

          } else {
            const Item = {
              templateId: value.templateId,
              attributes: { item_seen: false, variants: [] },
              quantity: value.quantity || 1,
            };
            athena.items[ID] = Item;
            MultiUpdate[0].profileChanges.push({ changeType: "itemAdded", itemId: ID, item: Item });
            Notifications[0].lootResult.items.push({ itemType: Item.templateId, itemGuid: ID, itemProfile: "athena", quantity: Item.quantity });
          }
        }

        if (
          findOfferId.offerId.prices[0].currencyType.toLowerCase() ==
          "mtxcurrency"
        ) {
          let paid = false;

          for (let key in profile.items) {
            if (
              !profile.items[key].templateId
                .toLowerCase()
                .startsWith("currency:mtx")
            )
              continue;

            let currencyPlatform = profile.items[key].attributes.platform;

            if (
              currencyPlatform.toLowerCase() !=
                profile.stats.attributes.current_mtx_platform.toLowerCase() &&
              currencyPlatform.toLowerCase() != "shared"
            )
              continue;

            if (
              profile.items[key].quantity <
              findOfferId.offerId.prices[0].finalPrice
            ) {
              return error.createError(
                "errors.com.epicgames.currency.mtx.insufficient",
                `You cannot afford this item (${findOfferId.offerId.prices[0].finalPrice}), you only have ${profile.items[key].quantity}.`,
                [
                  `${findOfferId.offerId.prices[0].finalPrice}`,
                  `${profile.items[key].quantity}`,
                ],
                1040,
                undefined,
                400,
                res,
              );
            }

            profile.items[key].quantity -=
              findOfferId.offerId.prices[0].finalPrice;
            profile0.items[key].quantity -=
              findOfferId.offerId.prices[0].finalPrice;

            ApplyProfileChanges.push(
              {
                changeType: "itemQuantityChanged",
                itemId: key,
                quantity: profile.items[key].quantity,
              },
              {
                changeType: "itemQuantityChanged",
                itemId: key,
                quantity: profile0.items[key].quantity,
              },
            );

            paid = true;
            break;
          }

          if (!paid && findOfferId.offerId.prices[0].finalPrice > 0) {
            return error.createError(
              "errors.com.epicgames.currency.mtx.insufficient",
              `You cannot afford this item (${findOfferId.offerId.prices[0].finalPrice}).`,
              [`${findOfferId.offerId.prices[0].finalPrice}`],
              1040,
              undefined,
              400,
              res,
            );
          }

          if (findOfferId.offerId.itemGrants.length != 0) {
            if (!profile.stats.attributes.mtx_purchase_history) {
              profile.stats.attributes.mtx_purchase_history = { purchases: [] };
            }
            if (!profile0.stats.attributes.mtx_purchase_history) {
              profile0.stats.attributes.mtx_purchase_history = {
                purchases: [],
              };
            }

            let purchaseId = functions.MakeID();
            profile.stats.attributes.mtx_purchase_history.purchases.push({
              purchaseId: purchaseId,
              offerId: `v2:/${purchaseId}`,
              purchaseDate: new Date().toISOString(),
              freeRefundEligible: false,
              fulfillments: [],
              lootResult: Notifications[0].lootResult.items,
              totalMtxPaid: findOfferId.offerId.prices[0].finalPrice,
              metadata: {},
              gameContext: "",
            });
            profile0.stats.attributes.mtx_purchase_history.purchases.push({
              purchaseId: purchaseId,
              offerId: `v2:/${purchaseId}`,
              purchaseDate: new Date().toISOString(),
              freeRefundEligible: false,
              fulfillments: [],
              lootResult: Notifications[0].lootResult.items,
              totalMtxPaid: findOfferId.offerId.prices[0].finalPrice,
              metadata: {},
              gameContext: "",
            });

            ApplyProfileChanges.push(
              {
                changeType: "statModified",
                name: "mtx_purchase_history",
                value: profile.stats.attributes.mtx_purchase_history,
              },
              {
                changeType: "statModified",
                name: "mtx_purchase_history",
                value: profile0.stats.attributes.mtx_purchase_history,
              },
            );
          }
        }

        break;
    }

    if (MultiUpdate[0].profileChanges.length > 0) {
      athena.rvn += 1;
      athena.commandRevision += 1;
      athena.updated = new Date().toISOString();
      MultiUpdate[0].profileRevision = athena.rvn;
      MultiUpdate[0].profileCommandRevision = athena.commandRevision;
    }

    if (ApplyProfileChanges.length > 0) {
      profile.rvn += 1;
      profile.commandRevision += 1;
      profile.updated = new Date().toISOString();
      await profiles?.updateOne({
        $set: {
          [`profiles.${req.query.profileId}`]: profile,
          [`profiles.athena`]: athena,
          [`profiles.profile0`]: profile0,
        },
      });
    }

    if (QueryRevision != ProfileRevisionCheck) {
      ApplyProfileChanges = [
        {
          changeType: "fullProfileUpdate",
          profile: profile,
        },
      ];
    }

    if (config.bEnableSACRewards === true) {
      const user = await User.findOne({ accountId: req.user.accountId });

      if (user && user.currentSACCode) {
        const sacCodeEntry = await SACCodeModel.findOne({
          $or: [
            { code: user.currentSACCode },
            { code_lower: user.currentSACCode.toLowerCase() },
            { code_higher: user.currentSACCode.toUpperCase() },
          ],
        });

        if (sacCodeEntry) {
          let findOfferId = functions.getOfferID(req.body.offerId);
          let purchaseQuantity = req.body.purchaseQuantity || 1;
          let totalPrice =
            findOfferId.offerId.prices[0].finalPrice * purchaseQuantity;
          const rewardAmount =
            (totalPrice * config.bPercentageSACRewards) / 100;

          const profile = await Profile.findOneAndUpdate(
            { accountId: sacCodeEntry.owneraccountId },
            {
              $inc: {
                "profiles.common_core.items.Currency:MtxPurchased.quantity":
                  rewardAmount,
              },
            },
          );

          if (!profile) {
          } else {
          }
        } else {
        }
      } else {
      }
    }

    res.json({
      profileRevision: profile.rvn || 0,
      profileId: req.query.profileId,
      profileChangesBaseRevision: BaseRevision,
      profileChanges: ApplyProfileChanges,
      notifications: Notifications,
      profileCommandRevision: profile.commandRevision || 0,
      serverTime: new Date().toISOString(),
      multiUpdate: MultiUpdate,
      responseVersion: 1,
    });

    if (ApplyProfileChanges.length > 0) {
      await profiles?.updateOne({
        $set: {
          [`profiles.${req.query.profileId}`]: profile,
          [`profiles.athena`]: athena,
          [`profiles.profile0`]: profile0,
        },
      });
    }

    return;
  },
);

router.post(
  "/fortnite/api/game/v2/profile/*/client/SetItemArchivedStatusBatch",
  async (req: Request, res: Response) => {
    const profiles = await Profile.findOne({ accountId: req.user.accountId });
    let profile = profiles.profiles[req.query.profileId];

    let ApplyProfileChanges = [];
    let BaseRevision = profile.rvn;
    let ProfileRevisionCheck =
      memory.build >= 12.2 ? profile.commandRevision : profile.rvn;
    let QueryRevision = req.query.rvn || -1;
    let StatChanged = false;

    if (req.body.itemIds) {
      for (let i in req.body.itemIds) {
        profile.items[req.body.itemIds[i]].attributes.archived =
          req.body.archived || false;

        ApplyProfileChanges.push({
          changeType: "itemAttrChanged",
          itemId: req.body.itemIds[i],
          attributeName: "archived",
          attributeValue:
            profile.items[req.body.itemIds[i]].attributes.archived,
        });
      }
      StatChanged = true;
    }

    if (StatChanged == true) {
      profile.rvn += 1;
      profile.commandRevision += 1;

      await profiles.updateOne({
        $set: { [`profiles.${req.query.profileId}`]: profile },
      });
    }

    if (QueryRevision != ProfileRevisionCheck) {
      ApplyProfileChanges = [
        {
          changeType: "fullProfileUpdate",
          profile: profile,
        },
      ];
    }

    res.json({
      profileRevision: profile.rvn || 0,
      profileId: req.query.profileId,
      profileChangesBaseRevision: BaseRevision,
      profileChanges: ApplyProfileChanges,
      profileCommandRevision: profile.commandRevision || 0,
      serverTime: new Date().toISOString(),
      responseVersion: 1,
    });
  },
);

router.post(
  "/fortnite/api/game/v2/profile/*/client/MarkItemSeen",
  verifyToken,
  async (req: Request, res: Response) => {
    const profiles = await Profile.findOne({ accountId: req.user.accountId });

    if (!(await profileManager.validateProfile(req.query.profileId, profiles)))
      return error.createError(
        "errors.com.epicgames.modules.profiles.operation_forbidden",
        `Unable to find template configuration for profile ${req.query.profileId}`,
        [req.query.profileId],
        12813,
        undefined,
        403,
        res,
      );

    let profile = profiles.profiles[req.query.profileId];

    const memory = functions.GetVersionInfo(req);

    if (req.query.profileId == "athena")
      profile.stats.attributes.season_num = memory.season;

    let ApplyProfileChanges = [];
    let BaseRevision = profile.rvn;
    let ProfileRevisionCheck =
      memory.build >= 12.2 ? profile.commandRevision : profile.rvn;
    let QueryRevision = req.query.rvn || -1;

    let missingFields = checkFields(["itemIds"], req.body);

    if (missingFields.fields.length > 0)
      return error.createError(
        "errors.com.epicgames.validation.validation_failed",
        `Validation Failed. [${missingFields.fields.join(", ")}] field(s) is missing.`,
        [`[${missingFields.fields.join(", ")}]`],
        1040,
        undefined,
        400,
        res,
      );

    if (!Array.isArray(req.body.itemIds))
      return ValidationError("itemIds", "an array", res);

    if (!profile.items) profile.items = {};

    for (let i in req.body.itemIds) {
      if (!profile.items[req.body.itemIds[i]]) continue;

      profile.items[req.body.itemIds[i]].attributes.item_seen = true;

      ApplyProfileChanges.push({
        changeType: "itemAttrChanged",
        itemId: req.body.itemIds[i],
        attributeName: "item_seen",
        attributeValue: true,
      });
    }

    if (ApplyProfileChanges.length > 0) {
      profile.rvn += 1;
      profile.commandRevision += 1;
      profile.updated = new Date().toISOString();

      await profiles.updateOne({
        $set: { [`profiles.${req.query.profileId}`]: profile },
      });
    }

    if (QueryRevision != ProfileRevisionCheck) {
      ApplyProfileChanges = [
        {
          changeType: "fullProfileUpdate",
          profile: profile,
        },
      ];
    }

    res.json({
      profileRevision: profile.rvn || 0,
      profileId: req.query.profileId,
      profileChangesBaseRevision: BaseRevision,
      profileChanges: ApplyProfileChanges,
      profileCommandRevision: profile.commandRevision || 0,
      serverTime: new Date().toISOString(),
      responseVersion: 1,
    });
  },
);

router.post(
  "/fortnite/api/game/v2/profile/*/client/SetItemFavoriteStatusBatch",
  verifyToken,
  async (req: Request, res: Response) => {
    const profiles = await Profile.findOne({ accountId: req.user.accountId });

    if (!(await profileManager.validateProfile(req.query.profileId, profiles)))
      return error.createError(
        "errors.com.epicgames.modules.profiles.operation_forbidden",
        `Unable to find template configuration for profile ${req.query.profileId}`,
        [req.query.profileId],
        12813,
        undefined,
        403,
        res,
      );

    if (req.query.profileId != "athena")
      return error.createError(
        "errors.com.epicgames.modules.profiles.invalid_command",
        `SetItemFavoriteStatusBatch is not valid on ${req.query.profileId} profile`,
        ["SetItemFavoriteStatusBatch", req.query.profileId],
        12801,
        undefined,
        400,
        res,
      );

    let profile = profiles.profiles[req.query.profileId];

    const memory = functions.GetVersionInfo(req);

    if (req.query.profileId == "athena")
      profile.stats.attributes.season_num = memory.season;

    let ApplyProfileChanges = [];
    let BaseRevision = profile.rvn;
    let ProfileRevisionCheck =
      memory.build >= 12.2 ? profile.commandRevision : profile.rvn;
    let QueryRevision = req.query.rvn || -1;

    let missingFields = checkFields(["itemIds", "itemFavStatus"], req.body);

    if (missingFields.fields.length > 0)
      return error.createError(
        "errors.com.epicgames.validation.validation_failed",
        `Validation Failed. [${missingFields.fields.join(", ")}] field(s) is missing.`,
        [`[${missingFields.fields.join(", ")}]`],
        1040,
        undefined,
        400,
        res,
      );

    if (!Array.isArray(req.body.itemIds))
      return ValidationError("itemIds", "an array", res);
    if (!Array.isArray(req.body.itemFavStatus))
      return ValidationError("itemFavStatus", "an array", res);

    if (!profile.items) profile.items = {};

    for (let i in req.body.itemIds) {
      if (!profile.items[req.body.itemIds[i]]) continue;
      if (typeof req.body.itemFavStatus[i] != "boolean") continue;

      profile.items[req.body.itemIds[i]].attributes.favorite =
        req.body.itemFavStatus[i];

      ApplyProfileChanges.push({
        changeType: "itemAttrChanged",
        itemId: req.body.itemIds[i],
        attributeName: "favorite",
        attributeValue: profile.items[req.body.itemIds[i]].attributes.favorite,
      });
    }

    if (ApplyProfileChanges.length > 0) {
      profile.rvn += 1;
      profile.commandRevision += 1;
      profile.updated = new Date().toISOString();

      await profiles.updateOne({
        $set: { [`profiles.${req.query.profileId}`]: profile },
      });
    }

    if (QueryRevision != ProfileRevisionCheck) {
      ApplyProfileChanges = [
        {
          changeType: "fullProfileUpdate",
          profile: profile,
        },
      ];
    }

    res.json({
      profileRevision: profile.rvn || 0,
      profileId: req.query.profileId,
      profileChangesBaseRevision: BaseRevision,
      profileChanges: ApplyProfileChanges,
      profileCommandRevision: profile.commandRevision || 0,
      serverTime: new Date().toISOString(),
      responseVersion: 1,
    });
  },
);

router.post(
  "/fortnite/api/game/v2/profile/*/client/SetBattleRoyaleBanner",
  verifyToken,
  async (req: Request, res: Response) => {

    const profiles = await Profile.findOne({ accountId: req.user.accountId });

    if (
      !(await profileManager.validateProfile(req.query.profileId, profiles))
    ) {
      return error.createError(
        "errors.com.epicgames.modules.profiles.operation_forbidden",
        `Unable to find template configuration for profile ${req.query.profileId}`,
        [req.query.profileId],
        12813,
        undefined,
        403,
        res,
      );
    }

    if (req.query.profileId != "athena") {
      return error.createError(
        "errors.com.epicgames.modules.profiles.invalid_command",
        `SetBattleRoyaleBanner is not valid on ${req.query.profileId} profile`,
        ["SetBattleRoyaleBanner", req.query.profileId],
        12801,
        undefined,
        400,
        res,
      );
    }

    let profile = profiles.profiles[req.query.profileId];

    const memory = functions.GetVersionInfo(req);

    if (req.query.profileId == "athena")
      profile.stats.attributes.season_num = memory.season;

    let ApplyProfileChanges = [];
    let BaseRevision = profile.rvn;
    let ProfileRevisionCheck =
      memory.build >= 12.2 ? profile.commandRevision : profile.rvn;
    let QueryRevision = req.query.rvn || -1;

    let missingFields = checkFields(
      ["homebaseBannerIconId", "homebaseBannerColorId"],
      req.body,
    );

    if (missingFields.fields.length > 0) {
      return error.createError(
        "errors.com.epicgames.validation.validation_failed",
        `Validation Failed. [${missingFields.fields.join(", ")}] field(s) is missing.`,
        [`[${missingFields.fields.join(", ")}]`],
        1040,
        undefined,
        400,
        res,
      );
    }

    if (typeof req.body.homebaseBannerIconId != "string") {
      return ValidationError("homebaseBannerIconId", "a string", res);
    }
    if (typeof req.body.homebaseBannerColorId != "string") {
      return ValidationError("homebaseBannerColorId", "a string", res);
    }

    let bannerProfileId = memory.build < 3.5 ? "profile0" : "common_core";

    let HomebaseBannerIconID = "";
    let HomebaseBannerColorID = "";

    if (!profiles.profiles[bannerProfileId].items)
      profiles.profiles[bannerProfileId].items = {};

    for (let itemId in profiles.profiles[bannerProfileId].items) {
      let templateId =
        profiles.profiles[bannerProfileId].items[itemId].templateId;

      if (
        templateId.toLowerCase() ==
        `HomebaseBannerIcon:${req.body.homebaseBannerIconId}`.toLowerCase()
      ) {
        HomebaseBannerIconID = itemId;
        continue;
      }
      if (
        templateId.toLowerCase() ==
        `HomebaseBannerColor:${req.body.homebaseBannerColorId}`.toLowerCase()
      ) {
        HomebaseBannerColorID = itemId;
        continue;
      }

      if (HomebaseBannerIconID && HomebaseBannerColorID) break;
    }

    if (!HomebaseBannerIconID) {
      return error.createError(
        "errors.com.epicgames.fortnite.item_not_found",
        `Banner template 'HomebaseBannerIcon:${req.body.homebaseBannerIconId}' not found in profile`,
        [`HomebaseBannerIcon:${req.body.homebaseBannerIconId}`],
        16006,
        undefined,
        400,
        res,
      );
    }

    if (!HomebaseBannerColorID) {
      return error.createError(
        "errors.com.epicgames.fortnite.item_not_found",
        `Banner template 'HomebaseBannerColor:${req.body.homebaseBannerColorId}' not found in profile`,
        [`HomebaseBannerColor:${req.body.homebaseBannerColorId}`],
        16006,
        undefined,
        400,
        res,
      );
    }

    if (!profile.items) profile.items = {};

    let activeLoadoutId =
      profile.stats.attributes.loadouts[
        profile.stats.attributes.active_loadout_index
      ];

    profile.stats.attributes.banner_icon = req.body.homebaseBannerIconId;
    profile.stats.attributes.banner_color = req.body.homebaseBannerColorId;

    profile.items[activeLoadoutId].attributes.banner_icon_template =
      req.body.homebaseBannerIconId;
    profile.items[activeLoadoutId].attributes.banner_color_template =
      req.body.homebaseBannerColorId;

    ApplyProfileChanges.push({
      changeType: "statModified",
      name: "banner_icon",
      value: profile.stats.attributes.banner_icon,
    });

    ApplyProfileChanges.push({
      changeType: "statModified",
      name: "banner_color",
      value: profile.stats.attributes.banner_color,
    });

    if (ApplyProfileChanges.length > 0) {
      profile.rvn += 1;
      profile.commandRevision += 1;
      profile.updated = new Date().toISOString();

      await profiles.updateOne({
        $set: { [`profiles.${req.query.profileId}`]: profile },
      });
    }

    if (QueryRevision != ProfileRevisionCheck) {
      ApplyProfileChanges = [
        {
          changeType: "fullProfileUpdate",
          profile: profile,
        },
      ];
    }

    res.json({
      profileRevision: profile.rvn || 0,
      profileId: req.query.profileId,
      profileChangesBaseRevision: BaseRevision,
      profileChanges: ApplyProfileChanges,
      profileCommandRevision: profile.commandRevision || 0,
      serverTime: new Date().toISOString(),
      responseVersion: 1,
    });
  },
);

router.post(
  "/fortnite/api/game/v2/profile/*/client/EquipBattleRoyaleCustomization",
  verifyToken,
  async (req: Request, res: Response) => {
    const profiles = await Profile.findOne({ accountId: req.user.accountId });

    if (!(await profileManager.validateProfile(req.query.profileId, profiles)))
      return error.createError(
        "errors.com.epicgames.modules.profiles.operation_forbidden",
        `Unable to find template configuration for profile ${req.query.profileId}`,
        [req.query.profileId],
        12813,
        undefined,
        403,
        res,
      );

    if (req.query.profileId != "athena")
      return error.createError(
        "errors.com.epicgames.modules.profiles.invalid_command",
        `EquipBattleRoyaleCustomization is not valid on ${req.query.profileId} profile`,
        ["EquipBattleRoyaleCustomization", req.query.profileId],
        12801,
        undefined,
        400,
        res,
      );

    let profile = profiles.profiles[req.query.profileId];

    const memory = functions.GetVersionInfo(req);

    if (req.query.profileId == "athena")
      profile.stats.attributes.season_num = memory.season;

    let ApplyProfileChanges = [];
    let BaseRevision = profile.rvn;
    let ProfileRevisionCheck =
      memory.build >= 12.2 ? profile.commandRevision : profile.rvn;
    let QueryRevision = req.query.rvn || -1;
    let specialCosmetics = [
      "AthenaCharacter:cid_random",
      "AthenaBackpack:bid_random",
      "AthenaPickaxe:pickaxe_random",
      "AthenaGlider:glider_random",
      "AthenaSkyDiveContrail:trails_random",
      "AthenaItemWrap:wrap_random",
      "AthenaMusicPack:musicpack_random",
      "AthenaLoadingScreen:lsid_random",
    ];

    let missingFields = checkFields(["slotName"], req.body);

    if (missingFields.fields.length > 0)
      return error.createError(
        "errors.com.epicgames.validation.validation_failed",
        `Validation Failed. [${missingFields.fields.join(", ")}] field(s) is missing.`,
        [`[${missingFields.fields.join(", ")}]`],
        1040,
        undefined,
        400,
        res,
      );

    if (typeof req.body.itemToSlot != "string")
      return ValidationError("itemToSlot", "a string", res);
    if (typeof req.body.slotName != "string")
      return ValidationError("slotName", "a string", res);

    if (!profile.items) profile.items = {};

    if (!profile.items[req.body.itemToSlot] && req.body.itemToSlot) {
      let item = req.body.itemToSlot;

      if (!specialCosmetics.includes(item)) {
        return error.createError(
          "errors.com.epicgames.fortnite.id_invalid",
          `Item (id: '${req.body.itemToSlot}') not found`,
          [req.body.itemToSlot],
          16027,
          undefined,
          400,
          res,
        );
      } else {
        if (!item.startsWith(`Athena${req.body.slotName}:`))
          return error.createError(
            "errors.com.epicgames.fortnite.id_invalid",
            `Cannot slot item of type ${item.split(":")[0]} in slot of category ${req.body.slotName}`,
            [item.split(":")[0], req.body.slotName],
            16027,
            undefined,
            400,
            res,
          );
      }
    }

    let slotNames = [
      "Character",
      "Backpack",
      "Pickaxe",
      "Glider",
      "SkyDiveContrail",
      "MusicPack",
      "LoadingScreen",
    ];
    let activeLoadoutId =
      profile.stats.attributes.loadouts[
        profile.stats.attributes.active_loadout_index
      ];
    let templateId = profile.items[req.body.itemToSlot]
      ? profile.items[req.body.itemToSlot].templateId
      : req.body.itemToSlot;

    if (profile.items[req.body.itemToSlot]) {
      if (
        !profile.items[req.body.itemToSlot].templateId.startsWith(
          `Athena${req.body.slotName}:`,
        )
      )
        return error.createError(
          "errors.com.epicgames.fortnite.id_invalid",
          `Cannot slot item of type ${profile.items[req.body.itemToSlot].templateId.split(":")[0]} in slot of category ${req.body.slotName}`,
          [
            profile.items[req.body.itemToSlot].templateId.split(":")[0],
            req.body.slotName,
          ],
          16027,
          undefined,
          400,
          res,
        );

      let Variants = req.body.variantUpdates;

      if (Array.isArray(Variants)) {
        if (!profile.items[req.body.itemToSlot].attributes.variants)
          profile.items[req.body.itemToSlot].attributes.variants = [];

        for (let i in Variants) {
          if (
            typeof Variants[i] != "object" ||
            !Variants[i].channel ||
            !Variants[i].active
          )
            continue;

          let index = profile.items[
            req.body.itemToSlot
          ].attributes.variants.findIndex(
            (x) => x.channel == Variants[i].channel,
          );

          if (index == -1) {
            profile.items[req.body.itemToSlot].attributes.variants.push({
              channel: Variants[i].channel,
              active: Variants[i].active,
              owned: [Variants[i].active],
            });
          } else {
            profile.items[req.body.itemToSlot].attributes.variants[
              index
            ].active = Variants[i].active;
            if (
              !profile.items[req.body.itemToSlot].attributes.variants[
                index
              ].owned.includes(Variants[i].active)
            ) {
              profile.items[req.body.itemToSlot].attributes.variants[
                index
              ].owned.push(Variants[i].active);
            }
          }
        }

        if (
          profile.items[activeLoadoutId] &&
          profile.items[activeLoadoutId].attributes.locker_slots_data.slots[
            req.body.slotName
          ]
        ) {
          profile.items[activeLoadoutId].attributes.locker_slots_data.slots[
            req.body.slotName
          ].activeVariants = [
            {
              variants: Variants.map((v) => ({
                channel: v.channel,
                active: v.active,
              })),
            },
          ];

          ApplyProfileChanges.push({
            changeType: "itemAttrChanged",
            itemId: activeLoadoutId,
            attributeName: "locker_slots_data",
            attributeValue:
              profile.items[activeLoadoutId].attributes.locker_slots_data,
          });
        }

        ApplyProfileChanges.push({
          changeType: "itemAttrChanged",
          itemId: req.body.itemToSlot,
          attributeName: "variants",
          attributeValue:
            profile.items[req.body.itemToSlot].attributes.variants,
        });
      }
    }

    switch (req.body.slotName) {
      case "Dance":
        if (
          !profile.items[activeLoadoutId].attributes.locker_slots_data.slots[
            req.body.slotName
          ]
        )
          break;

        if (typeof req.body.indexWithinSlot != "number")
          return ValidationError("indexWithinSlot", "a number", res);

        if (req.body.indexWithinSlot >= 0 && req.body.indexWithinSlot <= 5) {
          profile.stats.attributes.favorite_dance[req.body.indexWithinSlot] =
            req.body.itemToSlot;
          profile.items[
            activeLoadoutId
          ].attributes.locker_slots_data.slots.Dance.items[
            req.body.indexWithinSlot
          ] = templateId;

          ApplyProfileChanges.push({
            changeType: "statModified",
            name: "favorite_dance",
            value: profile.stats.attributes["favorite_dance"],
          });

          ApplyProfileChanges.push({
            changeType: "itemAttrChanged",
            itemId: activeLoadoutId,
            attributeName: "locker_slots_data",
            attributeValue:
              profile.items[activeLoadoutId].attributes.locker_slots_data,
          });
        }
        break;

      case "ItemWrap":
        if (
          !profile.items[activeLoadoutId].attributes.locker_slots_data.slots[
            req.body.slotName
          ]
        )
          break;

        if (typeof req.body.indexWithinSlot != "number")
          return ValidationError("indexWithinSlot", "a number", res);

        switch (true) {
          case req.body.indexWithinSlot >= 0 && req.body.indexWithinSlot <= 7:
            profile.stats.attributes.favorite_itemwraps[
              req.body.indexWithinSlot
            ] = req.body.itemToSlot;
            profile.items[
              activeLoadoutId
            ].attributes.locker_slots_data.slots.ItemWrap.items[
              req.body.indexWithinSlot
            ] = templateId;

            ApplyProfileChanges.push({
              changeType: "statModified",
              name: "favorite_itemwraps",
              value: profile.stats.attributes["favorite_itemwraps"],
            });
            break;

          case req.body.indexWithinSlot == -1:
            for (let i = 0; i < 7; i++) {
              profile.stats.attributes.favorite_itemwraps[i] =
                req.body.itemToSlot;
              profile.items[
                activeLoadoutId
              ].attributes.locker_slots_data.slots.ItemWrap.items[i] =
                templateId;
            }

            ApplyProfileChanges.push({
              changeType: "statModified",
              name: "favorite_itemwraps",
              value: profile.stats.attributes["favorite_itemwraps"],
            });
            break;
        }

        ApplyProfileChanges.push({
          changeType: "itemAttrChanged",
          itemId: activeLoadoutId,
          attributeName: "locker_slots_data",
          attributeValue:
            profile.items[activeLoadoutId].attributes.locker_slots_data,
        });
        break;

      default:
        if (!slotNames.includes(req.body.slotName)) break;
        if (
          !profile.items[activeLoadoutId].attributes.locker_slots_data.slots[
            req.body.slotName
          ]
        )
          break;

        if (req.body.slotName == "Pickaxe" || req.body.slotName == "Glider") {
          if (!req.body.itemToSlot)
            return error.createError(
              "errors.com.epicgames.fortnite.id_invalid",
              `${req.body.slotName} can not be empty.`,
              [req.body.slotName],
              16027,
              undefined,
              400,
              res,
            );
        }

        profile.stats.attributes[
          `favorite_${req.body.slotName}`.toLowerCase()
        ] = req.body.itemToSlot;
        profile.items[activeLoadoutId].attributes.locker_slots_data.slots[
          req.body.slotName
        ].items = [templateId];

        ApplyProfileChanges.push({
          changeType: "statModified",
          name: `favorite_${req.body.slotName}`.toLowerCase(),
          value:
            profile.stats.attributes[
              `favorite_${req.body.slotName}`.toLowerCase()
            ],
        });

        ApplyProfileChanges.push({
          changeType: "itemAttrChanged",
          itemId: activeLoadoutId,
          attributeName: "locker_slots_data",
          attributeValue:
            profile.items[activeLoadoutId].attributes.locker_slots_data,
        });
        break;
    }

    if (ApplyProfileChanges.length > 0) {
      profile.rvn += 1;
      profile.commandRevision += 1;
      profile.updated = new Date().toISOString();

      await profiles.updateOne({
        $set: { [`profiles.${req.query.profileId}`]: profile },
      });
    }

    if (QueryRevision != ProfileRevisionCheck) {
      ApplyProfileChanges = [
        {
          changeType: "fullProfileUpdate",
          profile: profile,
        },
      ];
    }

    res.json({
      profileRevision: profile.rvn || 0,
      profileId: req.query.profileId,
      profileChangesBaseRevision: BaseRevision,
      profileChanges: ApplyProfileChanges,
      profileCommandRevision: profile.commandRevision || 0,
      serverTime: new Date().toISOString(),
      responseVersion: 1,
    });
  },
);

router.post(
  "/fortnite/api/game/v2/profile/:accountId/client/CopyCosmeticLoadout",
  verifyToken,
  async (req: Request, res: Response) => {
    const profiles = await Profile.findOne({ accountId: req.user.accountId });
    let profile = profiles.profiles[req.query.profileId];

    const memory = functions.GetVersionInfo(req);

    if (!(await profileManager.validateProfile(req.query.profileId, profiles)))
      return error.createError(
        "errors.com.epicgames.modules.profiles.operation_forbidden",
        `Unable to find template configuration for profile ${req.query.profileId}`,
        [req.query.profileId],
        12813,
        undefined,
        403,
        res,
      );

    let ApplyProfileChanges = [];
    let BaseRevision = profile.rvn;
    let ProfileRevisionCheck =
      memory.build >= 12.2 ? profile.commandRevision : profile.rvn;
    let QueryRevision = req.query.rvn || -1;
    let item;

    if (req.body.sourceIndex == 0) {
      item = profile.items[`Fortnite${req.body.targetIndex}-loadout`];
      profile.items[`Fortnite${req.body.targetIndex}-loadout`] =
        profile.items["sandbox_loadout"];
      profile.items[`Fortnite${req.body.targetIndex}-loadout`].attributes[
        "locker_name"
      ] = req.body.optNewNameForTarget;
      profile.stats.attributes.loadouts[req.body.targetIndex] =
        `Fortnite${req.body.targetIndex}-loadout`;
      ApplyProfileChanges = [
        {
          changeType: "fullProfileUpdate",
          profile: profile,
        },
      ];
    } else {
      item = profile.items[`Fortnite${req.body.sourceIndex}-loadout`];
      if (!item)
        return error.createError(
          "errors.com.epicgames.modules.profiles.operation_forbidden",
          `Locker item {0} not found`,
          [req.query.profileId],
          12813,
          undefined,
          403,
          res,
        );

      profile.stats.attributes["active_loadout_index"] = req.body.sourceIndex;
      profile.stats.attributes["last_applied_loadout"] =
        `Fortnite${req.body.sourceIndex}-loadout`;
      profile.items["sandbox_loadout"].attributes["locker_slots_data"] =
        item.attributes["locker_slots_data"];
      ApplyProfileChanges = [
        {
          changeType: "fullProfileUpdate",
          profile: profile,
        },
      ];
    }

    if (ApplyProfileChanges.length > 0) {
      profile.rvn += 1;
      profile.commandRevision += 1;
      profile.updated = new Date().toISOString();
      await profiles.updateOne({
        $set: { [`profiles.${req.query.profileId}`]: profile },
      });
    }

    if (QueryRevision != ProfileRevisionCheck) {
      ApplyProfileChanges = [
        {
          changeType: "fullProfileUpdate",
          profile: profile,
        },
      ];
    }

    res.json({
      profileRevision: profile.rvn || 0,
      profileId: req.query.profileId,
      profileChangesBaseRevision: BaseRevision,
      profileChanges: ApplyProfileChanges,
      profileCommandRevision: profile.commandRevision || 0,
      serverTime: new Date().toISOString(),
      responseVersion: 1,
    });
  },
);
router.post(
  "/fortnite/api/game/v2/profile/:accountId/client/SetCosmeticLockerName",
  verifyToken,
  async (req: Request, res: Response) => {
    const profiles = await Profile.findOne({ accountId: req.user.accountId });
    let profile = profiles.profiles[req.query.profileId];

    const memory = functions.GetVersionInfo(req);

    if (!(await profileManager.validateProfile(req.query.profileId, profiles)))
      return error.createError(
        "errors.com.epicgames.modules.profiles.operation_forbidden",
        `Unable to find template configuration for profile ${req.query.profileId}`,
        [req.query.profileId],
        12813,
        undefined,
        403,
        res,
      );

    let ApplyProfileChanges = [];
    let BaseRevision = profile.rvn;
    let ProfileRevisionCheck =
      memory.build >= 12.2 ? profile.commandRevision : profile.rvn;
    let QueryRevision = req.query.rvn || -1;
    let item = profile.items[req.body.lockerItem];
    if (!item)
      return error.createError(
        "errors.com.epicgames.modules.profiles.operation_forbidden",
        `Locker item {0} not found`,
        [req.query.profileId],
        12813,
        undefined,
        403,
        res,
      );
    if (
      typeof req.body.name === "string" &&
      item.attributes.locker_name != req.body.name
    ) {
      item.attributes["locker_name"] = req.body.name;
      ApplyProfileChanges = [
        {
          changeType: "itemAttrChanged",
          itemId: req.body.lockerItem,
          itemName: item.templateId,
          item: item,
        },
      ];
      ApplyProfileChanges = [
        {
          changeType: "fullProfileUpdate",
          profile: profile,
        },
      ];
    }

    if (ApplyProfileChanges.length > 0) {
      profile.rvn += 1;
      profile.commandRevision += 1;
      profile.updated = new Date().toISOString();
      await profiles.updateOne({
        $set: { [`profiles.${req.query.profileId}`]: profile },
      });
    }
    if (QueryRevision != ProfileRevisionCheck) {
      ApplyProfileChanges = [
        {
          changeType: "fullProfileUpdate",
          profile: profile,
        },
      ];
    }
    res.json({
      profileRevision: profile.rvn || 0,
      profileId: req.query.profileId,
      profileChangesBaseRevision: BaseRevision,
      profileChanges: ApplyProfileChanges,
      profileCommandRevision: profile.commandRevision || 0,
      serverTime: new Date().toISOString(),
      responseVersion: 1,
    });
  },
);

router.post(
  "/fortnite/api/game/v2/profile/*/client/DeleteCosmeticLoadout",
  verifyToken,
  async (req: Request, res: Response) => {
    const profiles = await Profile.findOne({ accountId: req.user.accountId });
    let profile = profiles.profiles[req.query.profileId];

    const memory = functions.GetVersionInfo(req);

    if (!(await profileManager.validateProfile(req.query.profileId, profiles)))
      return error.createError(
        "errors.com.epicgames.modules.profiles.operation_forbidden",
        `Unable to find template configuration for profile ${req.query.profileId}`,
        [req.query.profileId],
        12813,
        undefined,
        403,
        res,
      );

    let ApplyProfileChanges = [];
    let BaseRevision = profile.rvn;
    let ProfileRevisionCheck =
      memory.build >= 12.2 ? profile.commandRevision : profile.rvn;
    let QueryRevision = req.query.rvn || -1;

    if (req.body.leaveNullSlot == false) {
    } else {
      let loadoutname = `Fortnite${req.body.index}-loadout`;
      if (req.body.fallbackLoadoutIndex == -1) {
        delete profile.items[loadoutname];
        delete profile.stats.attributes.loadouts[req.body.index];
        ApplyProfileChanges = [
          {
            changeType: "fullProfileUpdate",
            profile: profile,
          },
        ];
      } else {
        let newLoadout =
          profile.stats.attributes.loadouts[req.body.fallbackLoadoutIndex];
        profile.stats.attributes["last_applied_loadout"] = newLoadout;
        profile.stats.attributes["active_loadout_index"] =
          req.body.fallbackLoadoutIndex;
        profile.items["sandbox_loadout"].attributes["locker_slots_data"] =
          profile.items[newLoadout].attributes["locker_slots_data"];
        delete profile.items[loadoutname];
        delete profile.stats.attributes.loadouts[req.body.index];
        ApplyProfileChanges = [
          {
            changeType: "fullProfileUpdate",
            profile: profile,
          },
        ];
      }
    }

    if (ApplyProfileChanges.length > 0) {
      profile.rvn += 1;
      profile.commandRevision += 1;
      profile.updated = new Date().toISOString();
      await profiles.updateOne({
        $set: { [`profiles.${req.query.profileId}`]: profile },
      });
    }

    if (QueryRevision != ProfileRevisionCheck) {
      ApplyProfileChanges = [
        {
          changeType: "fullProfileUpdate",
          profile: profile,
        },
      ];
    }

    res.json({
      profileRevision: profile.rvn || 0,
      profileId: req.query.profileId,
      profileChangesBaseRevision: BaseRevision,
      profileChanges: ApplyProfileChanges,
      profileCommandRevision: profile.commandRevision || 0,
      serverTime: new Date().toISOString(),
      responseVersion: 1,
    });
  },
);

router.post(
  "/fortnite/api/game/v2/profile/*/client/SetCosmeticLockerBanner",
  verifyToken,
  async (req: Request, res: Response) => {
    const profiles = await Profile.findOne({ accountId: req.user.accountId });

    if (!(await profileManager.validateProfile(req.query.profileId, profiles)))
      return error.createError(
        "errors.com.epicgames.modules.profiles.operation_forbidden",
        `Unable to find template configuration for profile ${req.query.profileId}`,
        [req.query.profileId],
        12813,
        undefined,
        403,
        res,
      );

    if (req.query.profileId != "athena")
      return error.createError(
        "errors.com.epicgames.modules.profiles.invalid_command",
        `SetCosmeticLockerBanner is not valid on ${req.query.profileId} profile`,
        ["SetCosmeticLockerBanner", req.query.profileId],
        12801,
        undefined,
        400,
        res,
      );

    let profile = profiles.profiles[req.query.profileId];

    const memory = functions.GetVersionInfo(req);

    if (req.query.profileId == "athena")
      profile.stats.attributes.season_num = memory.season;

    let ApplyProfileChanges = [];
    let BaseRevision = profile.rvn;
    let ProfileRevisionCheck =
      memory.build >= 12.2 ? profile.commandRevision : profile.rvn;
    let QueryRevision = req.query.rvn || -1;

    let missingFields = checkFields(
      ["bannerIconTemplateName", "bannerColorTemplateName", "lockerItem"],
      req.body,
    );

    if (missingFields.fields.length > 0)
      return error.createError(
        "errors.com.epicgames.validation.validation_failed",
        `Validation Failed. [${missingFields.fields.join(", ")}] field(s) is missing.`,
        [`[${missingFields.fields.join(", ")}]`],
        1040,
        undefined,
        400,
        res,
      );

    if (typeof req.body.lockerItem != "string")
      return ValidationError("lockerItem", "a string", res);
    if (typeof req.body.bannerIconTemplateName != "string")
      return ValidationError("bannerIconTemplateName", "a string", res);
    if (typeof req.body.bannerColorTemplateName != "string")
      return ValidationError("bannerColorTemplateName", "a string", res);

    if (!profile.items) profile.items = {};

    if (!profile.items[req.body.lockerItem])
      return error.createError(
        "errors.com.epicgames.fortnite.id_invalid",
        `Item (id: '${req.body.lockerItem}') not found`,
        [req.body.lockerItem],
        16027,
        undefined,
        400,
        res,
      );

    if (
      profile.items[req.body.lockerItem].templateId.toLowerCase() !=
      "cosmeticlocker:cosmeticlocker_athena"
    )
      return error.createError(
        "errors.com.epicgames.fortnite.id_invalid",
        `lockerItem id is not a cosmeticlocker`,
        ["lockerItem"],
        16027,
        undefined,
        400,
        res,
      );

    let bannerProfileId = "common_core";

    let HomebaseBannerIconID = "";
    let HomebaseBannerColorID = "";

    if (!profiles.profiles[bannerProfileId].items)
      profiles.profiles[bannerProfileId].items = {};

    for (let itemId in profiles.profiles[bannerProfileId].items) {
      let templateId =
        profiles.profiles[bannerProfileId].items[itemId].templateId;

      if (
        templateId.toLowerCase() ==
        `HomebaseBannerIcon:${req.body.bannerIconTemplateName}`.toLowerCase()
      ) {
        HomebaseBannerIconID = itemId;
        continue;
      }
      if (
        templateId.toLowerCase() ==
        `HomebaseBannerColor:${req.body.bannerColorTemplateName}`.toLowerCase()
      ) {
        HomebaseBannerColorID = itemId;
        continue;
      }

      if (HomebaseBannerIconID && HomebaseBannerColorID) break;
    }

    if (!HomebaseBannerIconID)
      return error.createError(
        "errors.com.epicgames.fortnite.item_not_found",
        `Banner template 'HomebaseBannerIcon:${req.body.bannerIconTemplateName}' not found in profile`,
        [`HomebaseBannerIcon:${req.body.bannerIconTemplateName}`],
        16006,
        undefined,
        400,
        res,
      );

    if (!HomebaseBannerColorID)
      return error.createError(
        "errors.com.epicgames.fortnite.item_not_found",
        `Banner template 'HomebaseBannerColor:${req.body.bannerColorTemplateName}' not found in profile`,
        [`HomebaseBannerColor:${req.body.bannerColorTemplateName}`],
        16006,
        undefined,
        400,
        res,
      );

    profile.items[req.body.lockerItem].attributes.banner_icon_template =
      req.body.bannerIconTemplateName;
    profile.items[req.body.lockerItem].attributes.banner_color_template =
      req.body.bannerColorTemplateName;

    profile.stats.attributes.banner_icon = req.body.bannerIconTemplateName;
    profile.stats.attributes.banner_color = req.body.bannerColorTemplateName;

    ApplyProfileChanges.push({
      changeType: "itemAttrChanged",
      itemId: req.body.lockerItem,
      attributeName: "banner_icon_template",
      attributeValue:
        profile.items[req.body.lockerItem].attributes.banner_icon_template,
    });

    ApplyProfileChanges.push({
      changeType: "itemAttrChanged",
      itemId: req.body.lockerItem,
      attributeName: "banner_color_template",
      attributeValue:
        profile.items[req.body.lockerItem].attributes.banner_color_template,
    });

    if (ApplyProfileChanges.length > 0) {
      profile.rvn += 1;
      profile.commandRevision += 1;
      profile.updated = new Date().toISOString();

      await profiles.updateOne({
        $set: { [`profiles.${req.query.profileId}`]: profile },
      });
    }

    if (QueryRevision != ProfileRevisionCheck) {
      ApplyProfileChanges = [
        {
          changeType: "fullProfileUpdate",
          profile: profile,
        },
      ];
    }

    res.json({
      profileRevision: profile.rvn || 0,
      profileId: req.query.profileId,
      profileChangesBaseRevision: BaseRevision,
      profileChanges: ApplyProfileChanges,
      profileCommandRevision: profile.commandRevision || 0,
      serverTime: new Date().toISOString(),
      responseVersion: 1,
    });
  },
);

router.post(
  "/fortnite/api/game/v2/profile/*/client/SetCosmeticLockerSlot",
  verifyToken,
  async (req: Request, res: Response) => {
    const profiles = await Profile.findOne({ accountId: req.user.accountId });

    if (!(await profileManager.validateProfile(req.query.profileId, profiles)))
      return error.createError(
        "errors.com.epicgames.modules.profiles.operation_forbidden",
        `Unable to find template configuration for profile ${req.query.profileId}`,
        [req.query.profileId],
        12813,
        undefined,
        403,
        res,
      );

    if (req.query.profileId != "athena")
      return error.createError(
        "errors.com.epicgames.modules.profiles.invalid_command",
        `SetCosmeticLockerSlot is not valid on ${req.query.profileId} profile`,
        ["SetCosmeticLockerSlot", req.query.profileId],
        12801,
        undefined,
        400,
        res,
      );

    let profile = profiles.profiles[req.query.profileId];

    const memory = functions.GetVersionInfo(req);

    if (req.query.profileId == "athena")
      profile.stats.attributes.season_num = memory.season;

    let ApplyProfileChanges = [];
    let BaseRevision = profile.rvn;
    let ProfileRevisionCheck =
      memory.build >= 12.2 ? profile.commandRevision : profile.rvn;
    let QueryRevision = req.query.rvn || -1;
    let specialCosmetics = [
      "AthenaCharacter:cid_random",
      "AthenaBackpack:bid_random",
      "AthenaPickaxe:pickaxe_random",
      "AthenaGlider:glider_random",
      "AthenaSkyDiveContrail:trails_random",
      "AthenaItemWrap:wrap_random",
      "AthenaMusicPack:musicpack_random",
      "AthenaLoadingScreen:lsid_random",
    ];

    let missingFields = checkFields(["category", "lockerItem"], req.body);

    if (missingFields.fields.length > 0)
      return error.createError(
        "errors.com.epicgames.validation.validation_failed",
        `Validation Failed. [${missingFields.fields.join(", ")}] field(s) is missing.`,
        [`[${missingFields.fields.join(", ")}]`],
        1040,
        undefined,
        400,
        res,
      );

    if (typeof req.body.itemToSlot != "string")
      return ValidationError("itemToSlot", "a string", res);
    if (typeof req.body.slotIndex != "number")
      return ValidationError("slotIndex", "a number", res);
    if (typeof req.body.lockerItem != "string")
      return ValidationError("lockerItem", "a string", res);
    if (typeof req.body.category != "string")
      return ValidationError("category", "a string", res);

    if (!profile.items) profile.items = {};

    let itemToSlotID = "";

    if (req.body.itemToSlot) {
      for (let itemId in profile.items) {
        if (
          profile.items[itemId].templateId.toLowerCase() ==
          req.body.itemToSlot.toLowerCase()
        ) {
          itemToSlotID = itemId;
          break;
        }
      }
    }

    if (!profile.items[req.body.lockerItem])
      return error.createError(
        "errors.com.epicgames.fortnite.id_invalid",
        `Item (id: '${req.body.lockerItem}') not found`,
        [req.body.lockerItem],
        16027,
        undefined,
        400,
        res,
      );

    if (
      profile.items[req.body.lockerItem].templateId.toLowerCase() !=
      "cosmeticlocker:cosmeticlocker_athena"
    )
      return error.createError(
        "errors.com.epicgames.fortnite.id_invalid",
        `lockerItem id is not a cosmeticlocker`,
        ["lockerItem"],
        16027,
        undefined,
        400,
        res,
      );

    if (!profile.items[itemToSlotID] && req.body.itemToSlot) {
      let item = req.body.itemToSlot;

      if (!specialCosmetics.includes(item)) {
        return error.createError(
          "errors.com.epicgames.fortnite.id_invalid",
          `Item (id: '${req.body.itemToSlot}') not found`,
          [req.body.itemToSlot],
          16027,
          undefined,
          400,
          res,
        );
      } else {
        if (!item.startsWith(`Athena${req.body.category}:`))
          return error.createError(
            "errors.com.epicgames.fortnite.id_invalid",
            `Cannot slot item of type ${item.split(":")[0]} in slot of category ${req.body.category}`,
            [item.split(":")[0], req.body.category],
            16027,
            undefined,
            400,
            res,
          );
      }
    }

    if (profile.items[itemToSlotID]) {
      if (
        !profile.items[itemToSlotID].templateId.startsWith(
          `Athena${req.body.category}:`,
        )
      )
        return error.createError(
          "errors.com.epicgames.fortnite.id_invalid",
          `Cannot slot item of type ${profile.items[itemToSlotID].templateId.split(":")[0]} in slot of category ${req.body.category}`,
          [
            profile.items[itemToSlotID].templateId.split(":")[0],
            req.body.category,
          ],
          16027,
          undefined,
          400,
          res,
        );

      let Variants = req.body.variantUpdates;

      if (Array.isArray(Variants)) {
        if (!profile.items[itemToSlotID].attributes.variants)
          profile.items[itemToSlotID].attributes.variants = [];

        for (let i in Variants) {
          if (
            typeof Variants[i] != "object" ||
            !Variants[i].channel ||
            !Variants[i].active
          )
            continue;

          let index = profile.items[itemToSlotID].attributes.variants.findIndex(
            (x) => x.channel == Variants[i].channel,
          );

          if (index == -1) {
            profile.items[itemToSlotID].attributes.variants.push({
              channel: Variants[i].channel,
              active: Variants[i].active,
              owned: [Variants[i].active],
            });
          } else {
            profile.items[itemToSlotID].attributes.variants[index].active =
              Variants[i].active;
            if (
              !profile.items[itemToSlotID].attributes.variants[
                index
              ].owned.includes(Variants[i].active)
            ) {
              profile.items[itemToSlotID].attributes.variants[index].owned.push(
                Variants[i].active,
              );
            }
          }
        }

        if (
          profile.items[req.body.lockerItem] &&
          profile.items[req.body.lockerItem].attributes.locker_slots_data.slots[
            req.body.category
          ]
        ) {
          profile.items[req.body.lockerItem].attributes.locker_slots_data.slots[
            req.body.category
          ].activeVariants = [
            {
              variants: Variants.map((v) => ({
                channel: v.channel,
                active: v.active,
              })),
            },
          ];
        }

        ApplyProfileChanges.push({
          changeType: "itemAttrChanged",
          itemId: itemToSlotID,
          attributeName: "variants",
          attributeValue: profile.items[itemToSlotID].attributes.variants,
        });
      }
    }

    switch (req.body.category) {
      case "Dance":
        if (
          !profile.items[req.body.lockerItem].attributes.locker_slots_data
            .slots[req.body.category]
        )
          break;

        if (req.body.slotIndex >= 0 && req.body.slotIndex <= 5) {
          profile.items[
            req.body.lockerItem
          ].attributes.locker_slots_data.slots.Dance.items[req.body.slotIndex] =
            req.body.itemToSlot;
          profile.stats.attributes.favorite_dance[req.body.slotIndex] =
            itemToSlotID || req.body.itemToSlot;

          ApplyProfileChanges.push({
            changeType: "itemAttrChanged",
            itemId: req.body.lockerItem,
            attributeName: "locker_slots_data",
            attributeValue:
              profile.items[req.body.lockerItem].attributes.locker_slots_data,
          });
        }
        break;

      case "ItemWrap":
        if (
          !profile.items[req.body.lockerItem].attributes.locker_slots_data
            .slots[req.body.category]
        )
          break;

        switch (true) {
          case req.body.slotIndex >= 0 && req.body.slotIndex <= 7:
            profile.items[
              req.body.lockerItem
            ].attributes.locker_slots_data.slots.ItemWrap.items[
              req.body.slotIndex
            ] = req.body.itemToSlot;
            profile.stats.attributes.favorite_itemwraps[req.body.slotIndex] =
              itemToSlotID || req.body.itemToSlot;

            ApplyProfileChanges.push({
              changeType: "itemAttrChanged",
              itemId: req.body.lockerItem,
              attributeName: "locker_slots_data",
              attributeValue:
                profile.items[req.body.lockerItem].attributes.locker_slots_data,
            });
            break;

          case req.body.slotIndex == -1:
            for (let i = 0; i < 7; i++) {
              profile.items[
                req.body.lockerItem
              ].attributes.locker_slots_data.slots.ItemWrap.items[i] =
                req.body.itemToSlot;
              profile.stats.attributes.favorite_itemwraps[i] =
                itemToSlotID || req.body.itemToSlot;
            }

            ApplyProfileChanges.push({
              changeType: "itemAttrChanged",
              itemId: req.body.lockerItem,
              attributeName: "locker_slots_data",
              attributeValue:
                profile.items[req.body.lockerItem].attributes.locker_slots_data,
            });
            break;
        }
        break;

      default:
        if (
          !profile.items[req.body.lockerItem].attributes.locker_slots_data
            .slots[req.body.category]
        )
          break;

        if (req.body.category == "Pickaxe" || req.body.category == "Glider") {
          if (!req.body.itemToSlot)
            return error.createError(
              "errors.com.epicgames.fortnite.id_invalid",
              `${req.body.category} can not be empty.`,
              [req.body.category],
              16027,
              undefined,
              400,
              res,
            );
        }

        profile.items[req.body.lockerItem].attributes.locker_slots_data.slots[
          req.body.category
        ].items = [req.body.itemToSlot];
        profile.stats.attributes[
          `favorite_${req.body.category}`.toLowerCase()
        ] = itemToSlotID || req.body.itemToSlot;

        ApplyProfileChanges.push({
          changeType: "itemAttrChanged",
          itemId: req.body.lockerItem,
          attributeName: "locker_slots_data",
          attributeValue:
            profile.items[req.body.lockerItem].attributes.locker_slots_data,
        });
        break;
    }

    if (ApplyProfileChanges.length > 0) {
      profile.rvn += 1;
      profile.commandRevision += 1;
      profile.updated = new Date().toISOString();

      await profiles.updateOne({
        $set: { [`profiles.${req.query.profileId}`]: profile },
      });
    }

    if (QueryRevision != ProfileRevisionCheck) {
      ApplyProfileChanges = [
        {
          changeType: "fullProfileUpdate",
          profile: profile,
        },
      ];
    }

    res.json({
      profileRevision: profile.rvn || 0,
      profileId: req.query.profileId,
      profileChangesBaseRevision: BaseRevision,
      profileChanges: ApplyProfileChanges,
      profileCommandRevision: profile.commandRevision || 0,
      serverTime: new Date().toISOString(),
      responseVersion: 1,
    });
  },
);

router.post(
  "/fortnite/api/game/v2/profile/*/client/PutModularCosmeticLoadout",
  verifyToken,
  async (req: Request, res: Response) => {
    const profiles = await Profile.findOne({ accountId: req.user.accountId });
    let profile = profiles.profiles[req.query.profileId];

    let ApplyProfileChanges = [];
    let BaseRevision = profile.rvn || 0;
    let QueryRevision = req.query.rvn || -1;
    let StatChanged = false;

    if (!profile.stats.attributes.hasOwnProperty("loadout_presets")) {
      profile.stats.attributes.loadout_presets = {};

      ApplyProfileChanges.push({
        changeType: "statModified",
        name: "loadout_presets",
        value: {},
      });

      StatChanged = true;
    }

    if (
      !profile.stats.attributes.loadout_presets.hasOwnProperty(
        req.body.loadoutType,
      )
    ) {
      const NewLoadoutID = functions.MakeID();

      profile.items[NewLoadoutID] = {
        templateId: req.body.loadoutType,
        attributes: {},
        quantity: 1,
      };

      ApplyProfileChanges.push({
        changeType: "itemAdded",
        itemId: NewLoadoutID,
        item: profile.items[NewLoadoutID],
      });

      profile.stats.attributes.loadout_presets[req.body.loadoutType] = {
        [req.body.presetId]: NewLoadoutID,
      };

      ApplyProfileChanges.push({
        changeType: "statModified",
        name: "loadout_presets",
        value: profile.stats.attributes.loadout_presets,
      });

      StatChanged = true;
    }

    let LoadoutGUID = [];

    try {
      LoadoutGUID =
        profile.stats.attributes.loadout_presets[req.body.loadoutType][
          req.body.presetId
        ];
      profile.items[LoadoutGUID].attributes = JSON.parse(req.body.loadoutData);

      ApplyProfileChanges.push({
        changeType: "itemAttrChanged",
        itemId: LoadoutGUID,
        attributeName: "slots",
        attributeValue: profile.items[LoadoutGUID].attributes.slots,
      });

      StatChanged = true;
    } catch (err) {}

    if (StatChanged == true) {
      profile.rvn += 1;
      profile.commandRevision += 1;

      await profiles.updateOne({
        $set: { [`profiles.${req.query.profileId}`]: profile },
      });
    }

    if (QueryRevision != BaseRevision) {
      ApplyProfileChanges = [
        {
          changeType: "fullProfileUpdate",
          profile: profile,
        },
      ];
    }

    res.json({
      profileRevision: profile.rvn || 0,
      profileId: req.query.profileId,
      profileChangesBaseRevision: BaseRevision,
      profileChanges: ApplyProfileChanges,
      profileCommandRevision: profile.commandRevision || 0,
      serverTime: new Date().toISOString(),
      responseVersion: 1,
    });
  },
);

router.post(
  "/fortnite/api/game/v2/profile/*/client/:operation",
  verifyToken,
  async (req: Request, res: Response) => {
    
    const profiles = await Profile.findOne({ accountId: req.user.accountId });

    if (!(await profileManager.validateProfile(req.query.profileId, profiles))) {
      return error.createError(
        "errors.com.epicgames.modules.profiles.operation_forbidden",
        `Unable to find template configuration for profile ${req.query.profileId}`,
        [req.query.profileId],
        12813,
        undefined,
        403,
        res,
      );
    }

    let profile = profiles.profiles[req.query.profileId];

    if (profile.rvn == profile.commandRevision) {
      profile.rvn += 1;

      if (req.query.profileId == "athena") {
        if (!profile.stats.attributes.last_applied_loadout)
          profile.stats.attributes.last_applied_loadout =
            profile.stats.attributes.loadouts[0];

        const loadouts = profile.stats.attributes.loadouts || [];
        const activeIdx = profile.stats.attributes.active_loadout_index || 0;
        const activeLoadoutId = loadouts[activeIdx];
        const activeLoadout = profile.items?.[activeLoadoutId];
        const hasCharacter = activeLoadout?.attributes?.locker_slots_data?.slots?.Character?.items?.[0];
        if (!hasCharacter) {
          for (let i = 0; i < loadouts.length; i++) {
            const l = profile.items?.[loadouts[i]];
            if (l?.attributes?.locker_slots_data?.slots?.Character?.items?.[0]) {
              profile.stats.attributes.active_loadout_index = i;
              profile.stats.attributes.last_applied_loadout = loadouts[i];
              break;
            }
          }
        }
      }

      await profiles.updateOne({
        $set: { [`profiles.${req.query.profileId}`]: profile },
      });
    }

    const memory = functions.GetVersionInfo(req);

    if (req.query.profileId == "athena")
      profile.stats.attributes.season_num = memory.season;

    let MultiUpdate = [];

    if (
      req.query.profileId == "common_core" &&
      global.giftReceived[req.user.accountId]
    ) {
      global.giftReceived[req.user.accountId] = false;

      let athena = profiles.profiles["athena"];

      MultiUpdate = [
        {
          profileRevision: athena.rvn || 0,
          profileId: "athena",
          profileChangesBaseRevision: athena.rvn || 0,
          profileChanges: [
            {
              changeType: "fullProfileUpdate",
              profile: athena,
            },
          ],
          profileCommandRevision: athena.commandRevision || 0,
        },
      ];
    }

    let ApplyProfileChanges = [];
    let BaseRevision = profile.rvn;
    let ProfileRevisionCheck =
      memory.build >= 12.2 ? profile.commandRevision : profile.rvn;
    let QueryRevision = req.query.rvn || -1;

    switch (req.params.operation) {
      case "QueryProfile": {
        // Inject NoBattleBundleOption token so the upsell screen shows correct level count
        if (req.query.profileId === 'athena') {
          const bpSeason = functions.GetVersionInfo(req).season || 19;
          const tokenTemplateId = `Token:athena_s${bpSeason}_nobattlebundleoption_token`;
          const tokenKey = `Token:Athena_S${bpSeason}_NoBattleBundleOption_Token`;
          if (!profile.stats.attributes.book_purchased) {
            const needsSave = !profile.items[tokenKey] || profile.items[tokenKey].attributes.max_level_bonus !== 25;
            profile.items[tokenKey] = {
              templateId: tokenTemplateId,
              attributes: { max_level_bonus: 25, level: 1, item_seen: true, xp: 0, favorite: false },
              quantity: 1,
            };
            if (needsSave) {
              await profiles.updateOne({
                $set: { [`profiles.athena.items.${tokenKey}`]: profile.items[tokenKey] }
              });
            }
          }

          // Load and inject mini pass quests
          try {
            const miniPassPath = path.join(__dirname, '../../../Base/responses/MiniPasses/MiniPass.json');
            if (fs.existsSync(miniPassPath)) {
              const miniPassData = JSON.parse(fs.readFileSync(miniPassPath, 'utf-8'));
              let addedQuests = 0;
              
              for (const [questId, questData] of Object.entries(miniPassData)) {
                if (!profile.items[questId]) {
                  profile.items[questId] = questData;
                  addedQuests++;
                }
              }
              
              if (addedQuests > 0) {
                console.log(`[MINI PASS] Added ${addedQuests} mini pass quests to athena profile for ${req.user.accountId}`);
                await profiles.updateOne({
                  $set: { [`profiles.athena.items`]: profile.items }
                });
              }
            }
          } catch (error) {
            console.error('[MINI PASS] Error loading mini pass quests:', error);
          }
        }

        // Ensure common_core always has enough V-Bucks to purchase anything
        if (req.query.profileId === 'common_core') {
          const mtxKey = 'Currency:MtxPurchased';
          const hasMtx = Object.values(profile.items || {}).some((item: any) =>
            item.templateId?.toLowerCase().startsWith('currency:mtx')
          );
          if (!hasMtx) {
            profile.items = profile.items || {};
            profile.items[mtxKey] = {
              templateId: 'Currency:MtxPurchased',
              attributes: { platform: 'Shared' },
              quantity: 99999,
            };
            await profiles.updateOne({
              $set: { [`profiles.common_core.items.${mtxKey}`]: profile.items[mtxKey] }
            });
          }

          // Ensure mtx_affiliate is set to enable shop tab
          const needsAffiliate = !profile.stats.attributes.mtx_affiliate || profile.stats.attributes.mtx_affiliate === '';
          if (needsAffiliate) {
            console.log(`[SHOP TAB] Setting mtx_affiliate for ${req.user.accountId} to enable shop tab`);
            profile.stats.attributes.mtx_affiliate = 'Helix';
            profile.stats.attributes.mtx_affiliate_set_time = new Date().toISOString();
            await profiles.updateOne({
              $set: { 
                'profiles.common_core.stats.attributes.mtx_affiliate': 'Helix',
                'profiles.common_core.stats.attributes.mtx_affiliate_set_time': profile.stats.attributes.mtx_affiliate_set_time
              }
            });
          } else {
            console.log(`[SHOP TAB] mtx_affiliate already set to: ${profile.stats.attributes.mtx_affiliate}`);
          }

          // Ensure in_app_purchases has the full structure needed for shop tab
          const iap = profile.stats.attributes.in_app_purchases;
          const needsIap = !iap || !iap.refreshTimers || !iap.refreshTimers.EpicPurchasingService;
          if (needsIap) {
            profile.stats.attributes.in_app_purchases = {
              receipts: [],
              ignoredReceipts: [],
              fulfillmentCounts: {},
              refreshTimers: {
                MicrosoftStore: { nextEntitlementRefresh: "9999-12-01T21:10:00.000Z" },
                SamsungGalaxyAppStore: {},
                EpicPurchasingService: { nextEntitlementRefresh: "9999-12-01T21:10:00.000Z" }
              },
              version: 1
            };
            await profiles.updateOne({
              $set: { 'profiles.common_core.stats.attributes.in_app_purchases': profile.stats.attributes.in_app_purchases }
            });
          }
        }

        break;
      }
      case "ClientQuestLogin":
        break;
      case "RefreshExpeditions":
        break;
      case "GetMcpTimeForLogin":
        break;
      case "IncrementNamedCounterStat":
        break;
      case "SetHardcoreModifier":
        break;
      case "SetMtxPlatform":
        if (req.body.newPlatform) {
          profile.stats.attributes.current_mtx_platform = req.body.newPlatform;
          ApplyProfileChanges.push({ changeType: "statModified", name: "current_mtx_platform", value: req.body.newPlatform });
          profile.rvn += 1; profile.commandRevision += 1; profile.updated = new Date().toISOString();
          await profiles.updateOne({ $set: { [`profiles.${req.query.profileId}`]: profile } });
        }
        break;
      case "BulkEquipBattleRoyaleCustomization":
        break;
      case "PurchaseMultipleCatalogEntries":
        break;

      // Simple boolean/stat setters
      case "SetForcedIntroPlayed":
        profile.stats.attributes.forced_intro_played = req.body.forcedIntroPlayed ?? true;
        ApplyProfileChanges.push({ changeType: "statModified", name: "forced_intro_played", value: profile.stats.attributes.forced_intro_played });
        profile.rvn += 1; profile.commandRevision += 1; profile.updated = new Date().toISOString();
        await profiles.updateOne({ $set: { [`profiles.${req.query.profileId}`]: profile } });
        break;

      case "SetIntroGamePlayed":
        profile.stats.attributes.intro_game_played = true;
        ApplyProfileChanges.push({ changeType: "statModified", name: "intro_game_played", value: true });
        profile.rvn += 1; profile.commandRevision += 1; profile.updated = new Date().toISOString();
        await profiles.updateOne({ $set: { [`profiles.${req.query.profileId}`]: profile } });
        break;

      case "SkipTutorial":
        profile.stats.attributes.tutorial_step = 1000;
        ApplyProfileChanges.push({ changeType: "statModified", name: "tutorial_step", value: 1000 });
        profile.rvn += 1; profile.commandRevision += 1; profile.updated = new Date().toISOString();
        await profiles.updateOne({ $set: { [`profiles.${req.query.profileId}`]: profile } });
        break;

      case "SetLoadoutShuffleEnabled":
        if (typeof req.body.bShuffleEnabled === "boolean") {
          profile.stats.attributes.loadout_presets_enabled = req.body.bShuffleEnabled;
          ApplyProfileChanges.push({ changeType: "statModified", name: "loadout_presets_enabled", value: req.body.bShuffleEnabled });
          profile.rvn += 1; profile.commandRevision += 1; profile.updated = new Date().toISOString();
          await profiles.updateOne({ $set: { [`profiles.${req.query.profileId}`]: profile } });
        }
        break;

      case "SetRandomCosmeticLoadoutFlag":
        if (typeof req.body.bIsRandomLoadout === "boolean") {
          profile.stats.attributes.is_random_loadout = req.body.bIsRandomLoadout;
          ApplyProfileChanges.push({ changeType: "statModified", name: "is_random_loadout", value: req.body.bIsRandomLoadout });
          profile.rvn += 1; profile.commandRevision += 1; profile.updated = new Date().toISOString();
          await profiles.updateOne({ $set: { [`profiles.${req.query.profileId}`]: profile } });
        }
        break;

      case "SetMatchmakingBansViewed":
        profile.stats.attributes.matchmaking_bans_viewed = true;
        ApplyProfileChanges.push({ changeType: "statModified", name: "matchmaking_bans_viewed", value: true });
        profile.rvn += 1; profile.commandRevision += 1; profile.updated = new Date().toISOString();
        await profiles.updateOne({ $set: { [`profiles.${req.query.profileId}`]: profile } });
        break;

      case "SetSeasonPassAutoClaim":
        if (typeof req.body.bAutoClaim === "boolean") {
          // The game reads auto_spend_season_currency_ids, not season_pass_auto_claim
          if (!profile.stats.attributes.auto_spend_season_currency_ids) {
            profile.stats.attributes.auto_spend_season_currency_ids = [];
          }
          const seasonIds: string[] = req.body.seasonIds || [];
          for (const seasonId of seasonIds) {
            if (req.body.bAutoClaim) {
              if (!profile.stats.attributes.auto_spend_season_currency_ids.includes(seasonId)) {
                profile.stats.attributes.auto_spend_season_currency_ids.push(seasonId);
              }
            } else {
              const idx = profile.stats.attributes.auto_spend_season_currency_ids.indexOf(seasonId);
              if (idx !== -1) profile.stats.attributes.auto_spend_season_currency_ids.splice(idx, 1);
            }
          }
          ApplyProfileChanges.push({ changeType: "statModified", name: "auto_spend_season_currency_ids", value: profile.stats.attributes.auto_spend_season_currency_ids });
          profile.rvn += 1; profile.commandRevision += 1; profile.updated = new Date().toISOString();
          await profiles.updateOne({ $set: { [`profiles.${req.query.profileId}`]: profile } });
        }
        break;

      case "SetGameplayStats": {
        const stats = req.body.gameplayStats || [];
        for (const stat of stats) {
          if (!stat.statName) continue;
          profile.stats.attributes[stat.statName] = stat.statValue ?? 0;
          ApplyProfileChanges.push({ changeType: "statModified", name: stat.statName, value: stat.statValue ?? 0 });
        }
        if (ApplyProfileChanges.length > 0) {
          profile.rvn += 1; profile.commandRevision += 1; profile.updated = new Date().toISOString();
          await profiles.updateOne({ $set: { [`profiles.${req.query.profileId}`]: profile } });
        }
        break;
      }

      case "SetFactionChoice":
        if (req.body.factionId) {
          profile.stats.attributes.faction_id = req.body.factionId;
          ApplyProfileChanges.push({ changeType: "statModified", name: "faction_id", value: req.body.factionId });
          profile.rvn += 1; profile.commandRevision += 1; profile.updated = new Date().toISOString();
          await profiles.updateOne({ $set: { [`profiles.${req.query.profileId}`]: profile } });
        }
        break;

      case "SetItemFavoriteStatus": {
        const itemId = req.body.itemId;
        const favStatus = req.body.bFavorite;
        if (itemId && profile.items?.[itemId] && typeof favStatus === "boolean") {
          profile.items[itemId].attributes.favorite = favStatus;
          ApplyProfileChanges.push({ changeType: "itemAttrChanged", itemId, attributeName: "favorite", attributeValue: favStatus });
          profile.rvn += 1; profile.commandRevision += 1; profile.updated = new Date().toISOString();
          await profiles.updateOne({ $set: { [`profiles.${req.query.profileId}`]: profile } });
        }
        break;
      }

      case "SetCosmeticLockerSlots": {
        const loadoutId = req.body.loadoutId;
        const slotUpdates = req.body.slotUpdates || [];
        if (loadoutId && profile.items?.[loadoutId]) {
          for (const update of slotUpdates) {
            const { category, itemIds, slotIndex } = update;
            if (!category) continue;
            if (!profile.items[loadoutId].attributes.locker_slots_data) profile.items[loadoutId].attributes.locker_slots_data = { slots: {} };
            if (!profile.items[loadoutId].attributes.locker_slots_data.slots[category]) profile.items[loadoutId].attributes.locker_slots_data.slots[category] = { items: [], activeVariants: [] };
            if (slotIndex !== undefined && slotIndex >= 0) {
              profile.items[loadoutId].attributes.locker_slots_data.slots[category].items[slotIndex] = itemIds?.[0] || "";
            } else {
              profile.items[loadoutId].attributes.locker_slots_data.slots[category].items = itemIds || [];
            }
          }
          ApplyProfileChanges.push({ changeType: "itemAttrChanged", itemId: loadoutId, attributeName: "locker_slots_data", attributeValue: profile.items[loadoutId].attributes.locker_slots_data });
          profile.rvn += 1; profile.commandRevision += 1; profile.updated = new Date().toISOString();
          await profiles.updateOne({ $set: { [`profiles.${req.query.profileId}`]: profile } });
        }
        break;
      }

      case "AthenaTrackQuests": {
        const questIds = req.body.questIds || [];
        for (const qId of questIds) {
          if (profile.items?.[qId]) {
            profile.items[qId].attributes.quest_state = "Active";
            ApplyProfileChanges.push({ changeType: "itemAttrChanged", itemId: qId, attributeName: "quest_state", attributeValue: "Active" });
          }
        }
        if (ApplyProfileChanges.length > 0) {
          profile.rvn += 1; profile.commandRevision += 1; profile.updated = new Date().toISOString();
          await profiles.updateOne({ $set: { [`profiles.${req.query.profileId}`]: profile } });
        }
        break;
      }

      case "AthenaRemoveQuests": {
        const questIds = req.body.questIds || [];
        for (const qId of questIds) {
          if (profile.items?.[qId]) {
            delete profile.items[qId];
            ApplyProfileChanges.push({ changeType: "itemRemoved", itemId: qId });
          }
        }
        if (ApplyProfileChanges.length > 0) {
          profile.rvn += 1; profile.commandRevision += 1; profile.updated = new Date().toISOString();
          await profiles.updateOne({ $set: { [`profiles.${req.query.profileId}`]: profile } });
        }
        break;
      }

      case "ClaimLoginReward":
        ApplyProfileChanges.push({ changeType: "statModified", name: "daily_rewards", value: profile.stats.attributes.daily_rewards || {} });
        break;

      case "ClaimMfaEnabled":
        profile.stats.attributes.mfa_reward_claimed = true;
        ApplyProfileChanges.push({ changeType: "statModified", name: "mfa_reward_claimed", value: true });
        profile.rvn += 1; profile.commandRevision += 1; profile.updated = new Date().toISOString();
        await profiles.updateOne({ $set: { [`profiles.${req.query.profileId}`]: profile } });
        break;

      case "PopulatePrerolledOffers":
        ApplyProfileChanges.push({ changeType: "statModified", name: "mtx_purchase_history", value: profile.stats.attributes.mtx_purchase_history || { refundsUsed: 0, refundCredits: 3, purchases: [] } });
        break;

      case "ChallengeBundleLevelUp": {
        const bundleId = req.body.bundleId;
        if (bundleId && profile.items?.[bundleId]) {
          profile.items[bundleId].attributes.level = (profile.items[bundleId].attributes.level || 0) + 1;
          ApplyProfileChanges.push({ changeType: "itemAttrChanged", itemId: bundleId, attributeName: "level", attributeValue: profile.items[bundleId].attributes.level });
          profile.rvn += 1; profile.commandRevision += 1; profile.updated = new Date().toISOString();
          await profiles.updateOne({ $set: { [`profiles.${req.query.profileId}`]: profile } });
        }
        break;
      }

      case "EquipModularCosmeticLoadoutPreset": {
        const presetIndex = req.body.presetIndex ?? 0;
        profile.stats.attributes.active_loadout_index = presetIndex;
        ApplyProfileChanges.push({ changeType: "statModified", name: "active_loadout_index", value: presetIndex });
        profile.rvn += 1; profile.commandRevision += 1; profile.updated = new Date().toISOString();
        await profiles.updateOne({ $set: { [`profiles.${req.query.profileId}`]: profile } });
        break;
      }

      case "DeleteModularCosmeticLoadout": {
        const loadoutId = req.body.loadoutId;
        if (loadoutId && profile.items?.[loadoutId]) {
          delete profile.items[loadoutId];
          ApplyProfileChanges.push({ changeType: "itemRemoved", itemId: loadoutId });
          profile.rvn += 1; profile.commandRevision += 1; profile.updated = new Date().toISOString();
          await profiles.updateOne({ $set: { [`profiles.${req.query.profileId}`]: profile } });
        }
        break;
      }

      case "SetHomebaseBanner": {
        const { homebaseBannerIconId, homebaseBannerColorId } = req.body;
        if (homebaseBannerIconId) {
          profile.stats.attributes.homebase_icon = homebaseBannerIconId;
          ApplyProfileChanges.push({ changeType: "statModified", name: "homebase_icon", value: homebaseBannerIconId });
        }
        if (homebaseBannerColorId) {
          profile.stats.attributes.homebase_banner_color = homebaseBannerColorId;
          ApplyProfileChanges.push({ changeType: "statModified", name: "homebase_banner_color", value: homebaseBannerColorId });
        }
        if (ApplyProfileChanges.length > 0) {
          profile.rvn += 1; profile.commandRevision += 1; profile.updated = new Date().toISOString();
          await profiles.updateOne({ $set: { [`profiles.${req.query.profileId}`]: profile } });
        }
        break;
      }

      case "SetPinnedQuests": {
        const pinnedQuests = req.body.pinnedQuestIds || [];
        profile.stats.attributes.pinned_quest = pinnedQuests[0] || "";
        ApplyProfileChanges.push({ changeType: "statModified", name: "pinned_quest", value: profile.stats.attributes.pinned_quest });
        profile.rvn += 1; profile.commandRevision += 1; profile.updated = new Date().toISOString();
        await profiles.updateOne({ $set: { [`profiles.${req.query.profileId}`]: profile } });
        break;
      }

      case "SetLastUsedProject":
      case "SetLastUsedCreativePlot":
      case "SetLastUsedBattleLabFile":
      case "ModifyCreativePlotPermissions":
      case "SetCreativePlotMetadata":
      case "UpdatePlotPublishInfo":
      case "CreateNewIsland":
      case "CreateNewIslandFromLinkCode":
      case "DeleteIsland":
      case "DuplicateIsland":
      case "RestoreDeletedIsland":
      case "CreateNewBattleLabFile":
      case "DeleteBattleLabIsland":
      case "SetLastUsedBattleLabFile":
        // Creative operations - just return empty profile changes
        break;

      case "RedeemRealMoneyPurchases":
      case "VerifyRealMoneyPurchase":
        ApplyProfileChanges.push({ changeType: "statModified", name: "mtx_purchase_history", value: profile.stats.attributes.mtx_purchase_history || { refundsUsed: 0, refundCredits: 3, purchases: [] } });
        ApplyProfileChanges.push({
          changeType: "statModified",
          name: "in_app_purchases",
          value: {
            receipts: [],
            ignoredReceipts: [],
            fulfillmentCounts: {},
            refreshTimers: {
              MicrosoftStore: { nextEntitlementRefresh: "9999-12-01T21:10:00.000Z" },
              SamsungGalaxyAppStore: {},
              EpicPurchasingService: { nextEntitlementRefresh: "9999-12-01T21:10:00.000Z" }
            },
            version: 1
          }
        });
        ApplyProfileChanges.push({ changeType: "statModified", name: "subscriptions", value: [] });
        break;

      case "SetActiveHeroLoadout":
      case "ClearHeroLoadout":
      case "AssignHeroToLoadout":
      case "AssignGadgetToLoadout":
      case "AssignTeamPerkToLoadout":
      case "AssignWorkerToSquad":
      case "AssignWorkerToSquadBatch":
      case "AssignDefenderToLoadout":
      case "UnassignAllSquads":
        // STW loadout operations - no-op for BR server
        break;

      case "SetHomebaseName":
        if (req.body.homebaseName) {
          profile.stats.attributes.homebase_name = req.body.homebaseName;
          ApplyProfileChanges.push({ changeType: "statModified", name: "homebase_name", value: req.body.homebaseName });
          profile.rvn += 1; profile.commandRevision += 1; profile.updated = new Date().toISOString();
          await profiles.updateOne({ $set: { [`profiles.${req.query.profileId}`]: profile } });
        }
        break;

      case "ToggleQuestActiveState": {
        const questId = req.body.questId;
        const newState = req.body.questState || "Active";
        if (questId && profile.items?.[questId]) {
          profile.items[questId].attributes.quest_state = newState;
          ApplyProfileChanges.push({ changeType: "itemAttrChanged", itemId: questId, attributeName: "quest_state", attributeValue: newState });
          profile.rvn += 1; profile.commandRevision += 1; profile.updated = new Date().toISOString();
          await profiles.updateOne({ $set: { [`profiles.${req.query.profileId}`]: profile } });
        }
        break;
      }

      case "MarkCollectedItemsSeen": {
        const itemIds = req.body.itemIds || [];
        for (const id of itemIds) {
          if (profile.items?.[id]) {
            profile.items[id].attributes.item_seen = true;
            ApplyProfileChanges.push({ changeType: "itemAttrChanged", itemId: id, attributeName: "item_seen", attributeValue: true });
          }
        }
        if (ApplyProfileChanges.length > 0) {
          profile.rvn += 1; profile.commandRevision += 1; profile.updated = new Date().toISOString();
          await profiles.updateOne({ $set: { [`profiles.${req.query.profileId}`]: profile } });
        }
        break;
      }

      case "UpdateQuestClientObjectives":
        break;

      default:
        log(`[MCP] Unhandled operation: ${req.params.operation} (profileId: ${req.query.profileId})`);
        error.createError(
          "errors.com.epicgames.fortnite.operation_not_found",
          `Operation ${req.params.operation} not valid`,
          [req.params.operation],
          16035,
          undefined,
          404,
          res,
        );
        return;
    }

    if (QueryRevision != ProfileRevisionCheck) {
      ApplyProfileChanges = [
        {
          changeType: "fullProfileUpdate",
          profile: profile,
        },
      ];
    }

    res.json({
      profileRevision: profile.rvn || 0,
      profileId: req.query.profileId,
      profileChangesBaseRevision: BaseRevision,
      profileChanges: ApplyProfileChanges,
      profileCommandRevision: profile.commandRevision || 0,
      serverTime: new Date().toISOString(),
      multiUpdate: MultiUpdate,
      responseVersion: 1,
    });
  },
);

router.post(
  "/fortnite/api/game/v2/profile/:accountId/public/:operation",
  async (req: Request, res: Response) => {
    const profiles = await Profile.findOne({ accountId: req.params.accountId }).lean();
    if (!profiles) return res.status(404).json({});

    if (!(await profileManager.validateProfile(req.query.profileId, profiles)))
      return error.createError(
        "errors.com.epicgames.modules.profiles.operation_forbidden",
        `Unable to find template configuration for profile ${req.query.profileId}`,
        [req.query.profileId],
        12813,
        undefined,
        403,
        res,
      );

    const profile = profiles.profiles[req.query.profileId];
    const BaseRevision = profile.rvn;
    const QueryRevision = req.query.rvn || -1;

    let ApplyProfileChanges: any[] = [];
    if (QueryRevision != BaseRevision) {
      ApplyProfileChanges = [{ changeType: "fullProfileUpdate", profile }];
    }

    res.json({
      profileRevision: profile.rvn || 0,
      profileId: req.query.profileId,
      profileChangesBaseRevision: BaseRevision,
      profileChanges: ApplyProfileChanges,
      profileCommandRevision: profile.commandRevision || 0,
      serverTime: new Date().toISOString(),
      responseVersion: 1,
    });
  },
);

router.post(
  "/fortnite/api/game/v2/profile/:accountId/dedicated_server/:operation",
  async (req: Request, res: Response) => {
    const profiles = await Profile.findOne({
      accountId: req.params.accountId,
    }).lean();
    if (!profiles) return res.status(404).json({});

    if (!(await profileManager.validateProfile(req.query.profileId, profiles)))
      return error.createError(
        "errors.com.epicgames.modules.profiles.operation_forbidden",
        `Unable to find template configuration for profile ${req.query.profileId}`,
        [req.query.profileId],
        12813,
        undefined,
        403,
        res,
      );

    let profile = profiles.profiles[req.query.profileId];

    let ApplyProfileChanges = [];
    let BaseRevision = profile.rvn;
    let QueryRevision = req.query.rvn || -1;

    if (QueryRevision != BaseRevision) {
      ApplyProfileChanges = [
        {
          changeType: "fullProfileUpdate",
          profile: profile,
        },
      ];
    }

    res.json({
      profileRevision: profile.rvn || 0,
      profileId: req.query.profileId,
      profileChangesBaseRevision: BaseRevision,
      profileChanges: ApplyProfileChanges,
      profileCommandRevision: profile.commandRevision || 0,
      serverTime: new Date().toISOString(),
      responseVersion: 1,
    });
  },
);

function checkFields(fields, body) {
  let missingFields = { fields: [] };

  fields.forEach((field) => {
    if (!body[field]) missingFields.fields.push(field);
  });

  return missingFields;
}

function ValidationError(field, type, res) {
  return error.createError(
    "errors.com.epicgames.validation.validation_failed",
    `Validation Failed. '${field}' is not ${type}.`,
    [field],
    1040,
    undefined,
    400,
    res,
  );
}

function checkIfDuplicateExists(arr) {
  return new Set(arr).size !== arr.length;
}

export default router;
