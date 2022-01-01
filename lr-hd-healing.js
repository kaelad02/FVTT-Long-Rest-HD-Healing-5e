import HDLongRestDialog from "./new-long-rest.js";
import { libWrapper } from "./lib/libWrapper/shim.js";

const CALC_HD_RECOVERY = "CALC_HD_RECOVERY";

Hooks.on("init", () => {
    game.settings.register("long-rest-hd-healing", "recovery-mult-hitpoints", {
        name: "Hit Points Recovery Fraction",
        hint: "The fraction of missing hit points to recover on a long rest before rolling hit dice.",
        scope: "world",
        config: true,
        type: String,
        choices: {
            none: "None (default)",
            quarter: "Quarter",
            half: "Half",
            full: "Full",
        },
        default: "none",
    });

    game.settings.register("long-rest-hd-healing", "recovery-mult", {
        name: "Hit Dice Recovery Fraction",
        hint: "The fraction of hit dice to recover on a long rest. If this is set to \"Full\", hit dice will be auto-rolled.",
        scope: "world",
        config: true,
        type: String,
        choices: {
            none: "None",
            quarter: "Quarter",
            half: "Half (default)",
            full: "Full",
        },
        default: "half",
    });

    game.settings.register("long-rest-hd-healing", "recover-hd-before-rest", {
        name: "Recover Hit Dice Before Rolling",
        hint: "Whether to recover hit dice before rolling them on a long rest.",
        scope: "world",
        config: true,
        type: Boolean,
        default: false,
    });

    game.settings.register("long-rest-hd-healing", "recovery-rounding", {
        name: "Hit Dice Recovery Rounding",
        hint: "How to round the number of hit dice recovered.",
        scope: "world",
        config: true,
        type: String,
        choices: {
            down: "Round down (default)",
            up: "Round up",
        },
        default: "down",
    });

    game.settings.register("long-rest-hd-healing", "recovery-mult-resources", {
        name: "Resources Recovery Fraction",
        hint: "The fraction of resources to recover on a long rest.",
        scope: "world",
        config: true,
        type: String,
        choices: {
            none: "None",
            quarter: "Quarter",
            half: "Half",
            full: "Full (default)",
        },
        default: "full",
    });

    game.settings.register("long-rest-hd-healing", "recovery-mult-spells", {
        name: "Spell Slots Recovery Fraction",
        hint: "The fraction of spell slots to recover on a long rest (pact slots excluded).",
        scope: "world",
        config: true,
        type: String,
        choices: {
            none: "None",
            quarter: "Quarter",
            half: "Half",
            full: "Full (default)",
        },
        default: "full",
    });

    game.settings.register("long-rest-hd-healing", "recovery-mult-uses-others", {
        name: "Item Uses Recovery Fraction",
        hint: "The fraction of item uses (items, consumables, etc.) to recover on a long rest.",
        scope: "world",
        config: true,
        type: String,
        choices: {
            none: "None",
            quarter: "Quarter",
            half: "Half",
            full: "Full (default)",
        },
        default: "full",
    });

    game.settings.register("long-rest-hd-healing", "recovery-mult-uses-feats", {
        name: "Feat uses Recovery Fraction",
        hint: "The fraction of feat uses to recover on a long rest.",
        scope: "world",
        config: true,
        type: String,
        choices: {
            none: "None",
            quarter: "Quarter",
            half: "Half",
            full: "Full (default)",
        },
        default: "full",
    });

    game.settings.register("long-rest-hd-healing", "recovery-mult-day", {
        name: "Daily uses Recovery Fraction",
        hint: "The fraction of daily uses to recover on a long rest (items with the \"Day\" recovery setting).",
        scope: "world",
        config: true,
        type: String,
        choices: {
            none: "None",
            quarter: "Quarter",
            half: "Half",
            full: "Full (default)",
        },
        default: "full",
    });

    patch_newLongRest();
    patch_getRestHitPointRecovery();
    patch_getRestHitDiceRecovery();
    patch_getRestResourceRecovery();
    patch_getRestSpellRecovery();
    patch_getRestItemUsesRecovery();
});

function patch_newLongRest() {
    libWrapper.register(
        "long-rest-hd-healing",
        "CONFIG.Actor.documentClass.prototype.longRest",
        async function patchedLongRest(...args) {
            let { chat=true, dialog=true, newDay=true } = args[0] ?? {};

            const hd0 = this.data.data.attributes.hd;
            const hp0 = this.data.data.attributes.hp.value;

            // Before spending hit dice, recover a fraction of missing hit points (if applicable)...
            const hitPointsRecoveryMultSetting = game.settings.get("long-rest-hd-healing", "recovery-mult-hitpoints");
            const hitPointsRecoveryMultiplier = determineLongRestMultiplier(hitPointsRecoveryMultSetting);

            if (hitPointsRecoveryMultiplier) {
                const maxHP = this.data.data.attributes.hp.max;
                const recoveredHP = Math.floor((maxHP - hp0) * hitPointsRecoveryMultiplier);

                await this.update({ "data.attributes.hp.value": hp0 + recoveredHP });
            }

            // ... and recover hit dice (if applicable)
            if (recoverHDBeforeRoll()) {
                // This comes from the code for Actor5e._rest()
                let hitDiceUpdates = [];
                let hitDiceRecovered;
                // We call this with CALC_HD_RECOVERY to let the patched method know we're calling it.
                ({updates: hitDiceUpdates, hitDiceRecovered} = this._getRestHitDiceRecovery(CALC_HD_RECOVERY));
                await this.updateEmbeddedDocuments("Item", hitDiceUpdates);
            }

            // Maybe present a confirmation dialog
            if (dialog) {
                try {
                    newDay = await HDLongRestDialog.hdLongRestDialog({ actor: this });
                } catch (err) {
                    return;
                }
            }
            
            const recoveryHDMultSetting = game.settings.get("long-rest-hd-healing", "recovery-mult");
            if (recoveryHDMultSetting === "full") {
                // We'll autoroll all the hit dice, or till we get to max HP
                this.autoSpendHitDice({threshold: 0});
            }

            const dhd = this.data.data.attributes.hd - hd0;
            const dhp = this.data.data.attributes.hp.value - hp0;
            return this._rest(chat, newDay, true, dhd, dhp);
        },
        "OVERRIDE",
    );
}

function patch_getRestHitPointRecovery() {
    libWrapper.register(
        "long-rest-hd-healing",
        "CONFIG.Actor.documentClass.prototype._getRestHitPointRecovery",
        function patched_getRestHitPointRecovery(wrapped, ...args) {
            const currentHP = this.data.data.attributes.hp.value;
            const result = wrapped(...args);

            // Undo changes to hp from wrapped function
            result.updates["data.attributes.hp.value"] = currentHP;
            result.hitPointsRecovered = 0;
            return result;
        },
        "WRAPPER",
    );
}

function patch_getRestHitDiceRecovery() {
    libWrapper.register(
        "long-rest-hd-healing",
        "CONFIG.Actor.documentClass.prototype._getRestHitDiceRecovery",
        function patched_getRestHitDiceRecovery(wrapped, ...args) {
            let maxHitDice = args[0];
            const emptyReturn = { updates: [], hitDiceRecovered: 0 };
            // If recoverHDBeforeRoll(), we want to make sure _rest doesn't recover hit dice.
            // We only return a non-zero hitDiceToRecover when this module calls the method, with maxHitDice = CALC_HD_RECOVERY.
            if (recoverHDBeforeRoll()) {
                if (maxHitDice !== CALC_HD_RECOVERY) return emptyReturn;
                maxHitDice = undefined;
            }
            

            const recoveryHDMultSetting = game.settings.get("long-rest-hd-healing", "recovery-mult");
            const recoveryHDMultiplier = determineLongRestMultiplier(recoveryHDMultSetting);

            if (recoveryHDMultiplier === 0) return emptyReturn;

            const recoveryHDRoundSetting = game.settings.get("long-rest-hd-healing", "recovery-rounding");
            const recoveryHDRoundingFn = recoveryHDRoundSetting === "down" ? Math.floor : Math.ceil;

            const totalHitDice = this.data.data.details.level;
            const hitDiceToRecover = Math.clamped(recoveryHDRoundingFn(totalHitDice * recoveryHDMultiplier), 1, maxHitDice ?? totalHitDice);
            return wrapped({ maxHitDice: hitDiceToRecover });
        },
        "MIXED",
    );
}

function patch_getRestResourceRecovery() {
    libWrapper.register(
        "long-rest-hd-healing",
        "CONFIG.Actor.documentClass.prototype._getRestResourceRecovery",
        function patched_getRestResourceRecovery(...args) {
            const { recoverShortRestResources=true, recoverLongRestResources=true } = args[0] ?? {};

            const resourcesRecoveryMultSetting = game.settings.get("long-rest-hd-healing", "recovery-mult-resources");
            const resourcesRecoveryMultiplier = determineLongRestMultiplier(resourcesRecoveryMultSetting);

            if (resourcesRecoveryMultiplier === 0) return {};

            let updates = {};
            for ( let [k, r] of Object.entries(this.data.data.resources) ) {
                if (Number.isNumeric(r.max)) {
                    if (recoverShortRestResources && r.sr) {
                        updates[`data.resources.${k}.value`] = Number(r.max);
                    } else if (recoverLongRestResources && r.lr) {
                        let recoverResources = Math.max(Math.floor(r.max * resourcesRecoveryMultiplier), 1);
                        updates[`data.resources.${k}.value`] = Math.min(r.value + recoverResources, r.max);
                    }
                }
            }
            return updates;
        },
        "OVERRIDE",
    );
}

function patch_getRestSpellRecovery() {
    libWrapper.register(
        "long-rest-hd-healing",
        "CONFIG.Actor.documentClass.prototype._getRestSpellRecovery",
        function patched_getRestSpellRecovery(wrapped, ...args) {
            const { recoverPact=true, recoverSpells=true } = args[0] ?? {};

            const spellsRecoveryMultSetting = game.settings.get("long-rest-hd-healing", "recovery-mult-spells");
            const spellsRecoveryMultiplier = determineLongRestMultiplier(spellsRecoveryMultSetting);

            // Defer to the original method for recovering pact slots
            const results = wrapped({ recoverPact, recoverSpells: false });

            if (!recoverSpells || spellsRecoveryMultiplier === 0) return results;

            // But overwrite the logic for recovering other spell slots
            for ( let [k, v] of Object.entries(this.data.data.spells) ) {
                if (!v.override && !v.max) continue;
                let spellMax = v.override || v.max;
                let recoverSpells = Math.max(Math.floor(spellMax * spellsRecoveryMultiplier), 1);
                results[`data.spells.${k}.value`] = Math.min(v.value + recoverSpells, spellMax);
            }

            return results;
        },
        "WRAPPER",
    );
}

function patch_getRestItemUsesRecovery() {
    libWrapper.register(
        "long-rest-hd-healing",
        "CONFIG.Actor.documentClass.prototype._getRestItemUsesRecovery",
        function patched_getRestItemUsesRecovery(wrapped, ...args) {
            const { recoverShortRestUses=true, recoverLongRestUses=true, recoverDailyUses=true } = args[0] ?? {};

            const featsUsesRecoveryMultSetting = game.settings.get("long-rest-hd-healing", "recovery-mult-uses-feats");
            const featsUsesRecoveryMultiplier = determineLongRestMultiplier(featsUsesRecoveryMultSetting);
            const othersUsesRecoveryMultSetting = game.settings.get("long-rest-hd-healing", "recovery-mult-uses-others");
            const othersUsesRecoveryMultiplier = determineLongRestMultiplier(othersUsesRecoveryMultSetting);
            const dayRecoveryMultSetting = game.settings.get("long-rest-hd-healing", "recovery-mult-day");
            const dayRecoveryMultiplier = determineLongRestMultiplier(dayRecoveryMultSetting);

            const results = wrapped({ recoverShortRestUses, recoverLongRestUses: false, recoverDailyUses: false });

            for ( let item of this.items ) {
                _recoverItemUses(
                    item,
                    recoverLongRestUses, recoverDailyUses,
                    featsUsesRecoveryMultiplier, othersUsesRecoveryMultiplier, dayRecoveryMultiplier,
                    results,
                );
            }

            return results;
        },
        "WRAPPER",
    );

    function _recoverItemUses(
        item,
        recoverLongRestUses, recoverDailyUses,
        featsUsesRecoveryMultiplier, othersUsesRecoveryMultiplier, dayRecoveryMultiplier,
        results,
    ) {
        const itemData = item.data.data;
        if (itemData.uses) {
            if (recoverLongRestUses && itemData.uses.per === "lr") {
                const mult = item.type === "feat" ? featsUsesRecoveryMultiplier : othersUsesRecoveryMultiplier;
                _recoverUses(item.id, itemData.uses.value, itemData.uses.max, mult, results);
            } else if (recoverDailyUses && itemData.uses.per === "day") {
                _recoverUses(item.id, itemData.uses.value, itemData.uses.max, dayRecoveryMultiplier, results);
            }
        } else if (recoverLongRestUses && itemData.recharge && itemData.recharge.value) {
            results.push({ _id: item.id, "data.recharge.charged": true });
        }
    }

    function _recoverUses(itemId, usesCurrentValue, usesMax, multiplier, results) {
        if (multiplier === 0) return;
        let amountToRecover = Math.max(Math.floor(usesMax * multiplier), 1);
        let newValue = Math.min(usesCurrentValue + amountToRecover, usesMax);
        results.push({ _id: itemId, "data.uses.value": newValue });
    }
}

// Recover the multiplier based on setting
function determineLongRestMultiplier(multSetting) {
    let recoveryMultiplier = 1;

    switch (multSetting) {
        case "none":
            recoveryMultiplier = 0;
            break;
        case "quarter":
            recoveryMultiplier = 0.25;
            break;
        case "half":
            recoveryMultiplier = 0.5;
            break;
        case "full":
            recoveryMultiplier = 1.0;
            break;
        default:
            throw new Error(`Unable to parse recovery multiplier setting, got "${multSetting}".`);
    }

    return recoveryMultiplier;
}

// Determine whether to recover hit dice before rolling
function recoverHDBeforeRoll(){
    const recoveryHDMultSetting = game.settings.get("long-rest-hd-healing", "recovery-mult");
    return game.settings.get("long-rest-hd-healing", "recover-hd-before-rest") || recoveryHDMultSetting === "full";
}
