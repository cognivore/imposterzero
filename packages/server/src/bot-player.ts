export interface BotRegistry {
  readonly bots: ReadonlySet<string>;
}

export const emptyBotRegistry: BotRegistry = { bots: new Set() };

export const addBot = (registry: BotRegistry, playerId: string): BotRegistry => ({
  bots: new Set([...registry.bots, playerId]),
});

export const isBot = (registry: BotRegistry, playerId: string): boolean =>
  registry.bots.has(playerId);

export type NonEmptyReadonlyArray<A> = readonly [A, ...A[]];

export const pickRandom = <A>(actions: NonEmptyReadonlyArray<A>): A =>
  actions[Math.floor(Math.random() * actions.length)];
