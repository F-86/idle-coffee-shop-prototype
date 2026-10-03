/** Renderer-independent slice contract. All money is integer cents. x/z are metres. */
export type RecipeId = 'espresso' | 'latte';
export type CounterId = 'counter-a' | 'counter-b';
export type CustomerPhase = 'entering' | 'queue' | 'serving' | 'receiving' | 'leaving';
export interface Brew { recipe: RecipeId; elapsed: number; duration: number; price: number; customerId: number }
export interface Counter { id: CounterId; x: number; level: number; recipe: RecipeId; pendingCash: number; brewed: number; brew: Brew | null }
export interface Customer { id: number; x: number; z: number; phase: CustomerPhase; counterId: CounterId; timer: number; hasCup: boolean; skin: number }
export interface Manager { x: number; z: number; carrying: number; phase: 'moving' | 'collecting' | 'depositing'; target: number; timer: number; level: number }
export interface SliceState { schemaVersion: 1; economyVersion: 1; elapsed: number; wallet: number; totalEarned: number; totalServed: number; spend: number; nextCustomerId: number; arrivalTimer: number; inviteCooldown: number; paused: boolean; counters: Counter[]; customers: Customer[]; manager: Manager; lastOfflineClaimId: string | null; /** Persist fractional fixed-step time instead of throwing it away per frame. */ stepCarry?: number; /** Monotonic event IDs survive a save/reload. */ eventSequence?: number; /** Recent operation replay protection; the repository's savedAt is the interval authority. */ offlineClaimIds?: string[] }
export interface Recipe { id: RecipeId; name: string; price: number; brewSeconds: number; color: string; description: string }
export interface CounterQuote { cost: number; beforePrice: number; afterPrice: number; beforeSeconds: number; afterSeconds: number; paybackSeconds: number; capped: boolean }
export interface SliceEvent { id: number; type: 'arrived' | 'brewed' | 'served' | 'collected' | 'deposited' | 'upgraded' | 'recipe-changed' | 'invited'; amount?: number; counterId?: CounterId }
export interface SliceEngine { readonly state: SliceState; advance(seconds: number): void; invite(): boolean; upgrade(id: CounterId): boolean; upgradeManager(): boolean; setRecipe(id: CounterId, recipe: RecipeId): boolean; togglePause(): void; quote(id: CounterId): CounterQuote; managerQuote(): { cost: number; speed: number; nextSpeed: number; capped: boolean }; drainEvents(): SliceEvent[]; snapshot(): SliceState; applyOffline(seconds: number, claimId: string): { accepted: boolean; amount: number; seconds: number } }
