# blueprint/meal-planner

> Hermes source: grocery / recipes. Righthand-native recipe; see
> `blueprint.json` for the declarative spec.

Recipes become a plan: store recipes, extract ingredients, build the grocery list, schedule prep events, deliver through reminders.

## The recipe

1. store the recipe.
2. extract the ingredient list.
3. append to the grocery list (prefix-scan inventory).
4. schedule prep events and let the due check deliver.

## Tool matrix

| Step | Tool | Notes |
|---|---|---|
| store | rh_store_put | recipe:<slug> |
| extract | rh_text_extract | ingredients schema |
| list | rh_store_put / rh_store_list | grocery:<item> |
| schedule | rh_events_create + rh_events_due | prep reminders |

## Limits

nutrition math is out - the kit plans, it does not diet.