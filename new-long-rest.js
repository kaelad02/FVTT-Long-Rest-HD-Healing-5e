export default class HDLongRestDialog extends dnd5e.applications.actor.ShortRestDialog {
    static get defaultOptions() {
        return mergeObject(super.defaultOptions, {
            template: "modules/long-rest-hd-healing/templates/hd-long-rest.html",
            classes: ["dnd5e", "dialog"],
        });
    }

    getData() {
        const data = super.getData();
        const variant = game.settings.get("dnd5e", "restVariant");
        const recoveryHDMultSetting = game.settings.get("long-rest-hd-healing", "recovery-mult");
        data.promptNewDay = variant !== "gritty";     // It's always a new day when resting 1 week
        data.newDay = variant === "normal";           // It's probably a new day when resting normally (8 hours)
        // We'll autoroll if all hit dice are to be recovered.
        if (recoveryHDMultSetting === "full") data.canRoll = false;
        return data;
    }

    /** @returns {Promise<{ newDay: Boolean,  }>} */
    static async hdLongRestDialog({ actor } = {}) {
        return new Promise((resolve, reject) => {
            const dlg = new this(actor, {
                title: game.i18n.localize("DND5E.LongRest"),
                buttons: {
                    rest: {
                        icon: "<i class=\"fas fa-bed\"></i>",
                        label: game.i18n.localize("DND5E.Rest"),
                        callback: html => {
                            let newDay = true;
                            if (game.settings.get("dnd5e", "restVariant") !== "gritty") {
                                newDay = html.find("input[name=\"newDay\"]")[0].checked;
                            }
                            resolve(newDay);
                        },
                    },
                    cancel: {
                        icon: "<i class=\"fas fa-times\"></i>",
                        label: game.i18n.localize("Cancel"),
                        callback: reject,
                    },
                },
                default: "rest",
                close: reject,
            });
            dlg.render(true);
        });
    }
}
