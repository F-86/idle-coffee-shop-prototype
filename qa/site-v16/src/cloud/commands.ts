import type { CounterId, RecipeId, IngredientId, PurchaseMode, ShopLayout } from '../slice/core/types';
export type GameCommand =
 | {type:'sync'} | {type:'set-pause';paused:boolean} | {type:'invite'}
 | {type:'upgrade-counter';counterId:CounterId}
 | {type:'set-recipe';counterId:CounterId;recipe:RecipeId}
 | {type:'buy-ingredient';ingredient:IngredientId;mode:PurchaseMode;expectedCost:number;expectedQuantity:number}
 | {type:'commit-layout';layout:ShopLayout} | {type:'dismiss-migration'}
 | {type:'import';fileText:string;confirm:true} | {type:'reset';confirm:true};
