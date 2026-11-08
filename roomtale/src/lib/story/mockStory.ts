import { CHARACTER_PALETTE, newStoryId } from "./schema";
import type {
  Occupant,
  Position,
  SceneAnalysis,
  SceneAnalysisResponse,
  ShotMood,
  ShotSeconds,
  Story,
  StoryCharacter,
  SubjectHint,
} from "./types";

// Offline stand-in for the LLM: a themed screenplay cast from whoever the detector found.
// Lets the whole pipeline (camera → cutouts → movie) run with no API key.

interface Role {
  role: string;
  name: string;
  costume: string;
  personality: string;
}

interface ShotTemplate {
  /** Voiceover. {A} {B} {C} are character names, {ALL} the cast, {PROP} a room object. */
  say: string;
  /** Opening frame. {A} {B} {C} become "Name in costume"; {ALL} the whole cast. */
  scene: string;
  /** Blocking for the video model. {A} {B} {C} become "the <role>", what the model can see. */
  motion: string;
  mood: ShotMood;
  seconds: ShotSeconds;
}

interface ThemePack {
  match: RegExp;
  theme: string;
  title: (lead: string) => string;
  artStyle: string;
  roles: Role[];
  petRole: Role;
  /** Non-human stand-ins for {B} and {C} when the room has fewer people, so no stranger is invented. */
  standIns: [Role, Role];
  shots: ShotTemplate[];
}

const PACKS: ThemePack[] = [
  {
    match: /space|sci-?fi|alien|robot|planet|rocket|galaxy|star/i,
    theme: "silly sci-fi",
    title: (lead) => `${lead} and the Couch Galaxy`,
    artStyle: "hyper-realistic live-action footage, starlight and console glow, 35mm lens at eye level, everyone in sharp focus, subtle film grain",
    roles: [
      { role: "captain", name: "Captain Nova", costume: "a battle-worn silver space suit with a flowing cape", personality: "brave, and terrible at parking rockets" },
      { role: "engineer", name: "Engineer Zip", costume: "a navy flight suit with a glowing tool belt", personality: "can fix anything with tape" },
      { role: "lovable villain", name: "Emperor Snorkel", costume: "an enormous glass bubble helmet and a purple robe", personality: "wants every remote control in the galaxy" },
      { role: "navigator", name: "Pilot Comet", costume: "a white flight jacket and star-covered goggles", personality: "knows every shortcut through the asteroid belt" },
      { role: "stowaway", name: "Robo-Buddy", costume: "a dented silver robot suit with blinking lights", personality: "beeps whenever it is happy" },
      { role: "science officer", name: "Professor Orbit", costume: "a lab coat embroidered with tiny planets", personality: "explains everything twice" },
    ],
    petRole: { role: "space pup", name: "Astro-Pup", costume: "a tiny glass space helmet", personality: "can smell a meteor from a mile away" },
    standIns: [
      { role: "robot sidekick", name: "Robo-Buddy", costume: "a knee-high dented silver robot with blinking lights", personality: "beeps whenever it is happy" },
      { role: "alien emperor", name: "Emperor Snorkel", costume: "a wobbly green alien in an enormous glass bubble helmet", personality: "wants every remote control in the galaxy" },
    ],
    shots: [
      { say: "One ordinary evening, the couch began to rumble.", scene: "{ALL} sitting on a living room couch at night as it starts to shake and glow from underneath", motion: "Slow push-in as the couch trembles and everyone grabs the cushions, eyes wide.", mood: "mysterious", seconds: 5 },
      { say: "With a whoosh, it blasted through the ceiling and into space, carrying {A} and {B} past the moon!", scene: "{A} and {B} clinging to a couch rocketing through space past a giant cratered moon, flames trailing", motion: "Fast tracking shot alongside the flying couch as it banks past the moon; {A} and {B} lean into the turn.", mood: "exciting", seconds: 10 },
      { say: "\"Hold on, crew!\" {A} grabbed the {PROP} like a steering wheel.", scene: "On a spaceship bridge, {A} lunging for the controls while {B} runs up behind, a nebula filling the window", motion: "Slow dolly in as {A} grabs the controls and yanks them sideways while {B} stumbles and catches the console.", mood: "funny", seconds: 10 },
      { say: "Then a giant bubble ship appeared. It was {C}, hoarding every remote in the galaxy!", scene: "{C} standing inside a huge wobbling glass bubble ship surrounded by floating TV remotes, purple nebula behind", motion: "Low-angle push-in as the bubble ship wobbles closer and {C} spreads both arms over the pile of remotes.", mood: "mysterious", seconds: 10 },
      { say: "", scene: "{B} floating across a zero-gravity corridor holding out a bowl of popcorn toward {C}", motion: "Gentle orbit as popcorn drifts out of the bowl and {C} slowly reaches for a piece.", mood: "cozy", seconds: 5 },
      { say: "Together, everyone returned the remotes to every planet. The aliens cheered!", scene: "{ALL} striding into an alien planet plaza at golden hour with candy-colored domes, fireworks bursting and tiny aliens cheering", motion: "Slow crane up as everyone runs into the plaza waving, faces lighting up as fireworks burst and the aliens cheer.", mood: "triumphant", seconds: 10 },
      { say: "The couch landed home just in time for movie night. Everyone shared the remote. Mostly.", scene: "{ALL} tumbling off a smoking couch that has just landed back in a cozy living room at night, laughing", motion: "Handheld shot settling as the couch thumps down and everyone falls back onto the cushions laughing.", mood: "dreamy", seconds: 10 },
    ],
  },
  {
    match: /pirate|ship|treasure|sea|ocean|island/i,
    theme: "swashbuckling pirate adventure",
    title: (lead) => `${lead} and the Treasure of Pillow Island`,
    artStyle: "hyper-realistic live-action footage, golden-hour sunlight and sea spray, 35mm lens at eye level, everyone in sharp focus, subtle film grain",
    roles: [
      { role: "captain", name: "Captain Saltbeard", costume: "a long red captain's coat with brass buttons and a feathered hat", personality: "loud, proud and secretly afraid of crabs" },
      { role: "first mate", name: "First Mate Pickles", costume: "a striped shirt, sash and brass spyglass", personality: "spots everything except their own glasses" },
      { role: "lovable rival", name: "Barnacle Bess", costume: "a weathered leather vest and an eyepatch", personality: "wants the treasure only to buy a pony" },
      { role: "lookout", name: "Lookout Lulu", costume: "a red bandana and tall boots", personality: "sings sea shanties off key" },
      { role: "cook", name: "Cookie Crumbs", costume: "an apron over a sailor's shirt", personality: "makes soup out of anything" },
      { role: "mapmaker", name: "Mapmaker Moss", costume: "a cloak stitched from old treasure maps", personality: "always holds the map upside down" },
    ],
    petRole: { role: "ship's mascot", name: "Admiral Woof", costume: "a tiny tricorn hat and bandana", personality: "barks at every wave" },
    standIns: [
      { role: "parrot first mate", name: "Captain Squawk", costume: "a scarlet macaw parrot in a tiny tricorn hat", personality: "repeats every order, loudly" },
      { role: "crab rival", name: "Barnacle Bob", costume: "a giant orange crab wearing an eyepatch", personality: "wants the treasure only to buy a bigger shell" },
    ],
    shots: [
      { say: "The rug became a sea, and the couch became a mighty pirate ship!", scene: "{A} swinging on a rope across the deck of a pirate ship at golden hour while {B} hauls the rigging", motion: "Sweeping crane shot as {A} swings across the deck and the ship crests a wave.", mood: "exciting", seconds: 10 },
      { say: "\"Land ho!\" On the horizon sat Pillow Island.", scene: "{B} leaning off the bow with a brass spyglass, pointing at a misty island, {A} running up behind", motion: "Slow push-in over the shoulder as {B} lowers the spyglass and points.", mood: "mysterious", seconds: 5 },
      { say: "But {C} got there first, digging with a soup spoon!", scene: "{C} on a white-sand beach digging frantically with a giant soup spoon, sand spraying", motion: "Low tracking shot as sand sprays toward camera and {C} pops up grinning.", mood: "funny", seconds: 5 },
      { say: "The chest creaked open. Inside was a note: the real treasure is snack time with your crew.", scene: "{ALL} kneeling around an open treasure chest glowing warmly in a sunlit beach clearing", motion: "Slow push-in as they lift the lid together, eager faces falling into puzzled looks at the note, then bursting into laughter.", mood: "cozy", seconds: 10 },
      { say: "So everyone shared a mountain of cookies, and even the crabs danced.", scene: "{ALL} laughing around a beach picnic at sunset with a mountain of cookies, little crabs dancing in the sand", motion: "Gentle orbit as the crabs dance and {A} hops back nervously.", mood: "triumphant", seconds: 10 },
      { say: "", scene: "{ALL} leaning on the ship's rail under a starry sky, sailing toward a warmly lit house", motion: "Slow pull-back revealing the ship sailing home under the stars.", mood: "dreamy", seconds: 5 },
    ],
  },
  {
    match: /dino|dinosaur|jungle|safari|animal|wild/i,
    theme: "roaring dinosaur expedition",
    title: (lead) => `${lead} and the Very Polite Dinosaur`,
    artStyle: "hyper-realistic live-action footage, misty jungle light, 35mm lens at eye level, everyone in sharp focus, subtle film grain",
    roles: [
      { role: "expedition leader", name: "Ranger Rex", costume: "a khaki explorer vest with a hundred pockets", personality: "never goes anywhere without a sandwich" },
      { role: "scientist", name: "Doctor Fern", costume: "field gear and brass magnifying goggles", personality: "names every bug they meet" },
      { role: "lovable troublemaker", name: "Muddy Max", costume: "muddy rain boots and a yellow raincoat", personality: "jumps in every puddle" },
      { role: "photographer", name: "Snap Sunny", costume: "a safari shirt and a vintage camera", personality: "always says cheese" },
      { role: "guide", name: "Trail Tilly", costume: "a wide-brim hat woven with leaves", personality: "talks to trees" },
      { role: "chef", name: "Chef Chomp", costume: "a camp apron and a frying pan", personality: "cooks dino-sized pancakes" },
    ],
    petRole: { role: "tracker", name: "Sir Sniffs", costume: "a tiny explorer hat", personality: "can find anyone by smell" },
    standIns: [
      { role: "baby triceratops", name: "Pip", costume: "a baby triceratops with a red bandana", personality: "sneezes when excited" },
      { role: "monkey troublemaker", name: "Coco", costume: "a mischievous capuchin monkey in a tiny explorer hat", personality: "borrows everything without asking" },
    ],
    shots: [
      { say: "Behind the {PROP}, a secret door opened into a steaming jungle.", scene: "{A} and {B} stepping through a glowing doorway into a misty prehistoric jungle, giant ferns", motion: "Slow push through the doorway behind them as mist rolls past.", mood: "mysterious", seconds: 5 },
      { say: "Boom. Boom. A dinosaur taller than a house leaned down. \"Excuse me, have you seen my hat?\"", scene: "A towering gentle dinosaur lowering its head toward {A}, who freezes mid-step while {B} ducks behind a fern", motion: "Low-angle tilt up as the dinosaur lowers its head and sniffs as {A} slowly backs away.", mood: "funny", seconds: 10 },
      { say: "{C} had been wearing it the whole time, thinking it was a bowl!", scene: "{C} standing in a jungle lagoon wearing a comically giant hat beside a waterfall", motion: "Gentle dolly in as the hat slips down over the eyes of {C}, who bursts out laughing.", mood: "funny", seconds: 10 },
      { say: "To say thanks, the dinosaur gave everyone a ride above the treetops.", scene: "{ALL} riding on the back of a gentle giant dinosaur along a jungle ridge above a misty valley", motion: "Tracking shot alongside the dinosaur as it strides, the riders whooping with delight and clinging on as it dips.", mood: "exciting", seconds: 10 },
      { say: "That night, everyone flipped dino-sized pancakes by the fire.", scene: "{ALL} around a jungle campfire at night flipping enormous pancakes, fireflies glowing", motion: "Slow orbit as a pancake flips through the air and lands perfectly.", mood: "cozy", seconds: 10 },
      { say: "", scene: "{ALL} stepping out of a glowing doorway into a cozy living room in morning light, muddy and grinning", motion: "Static wide shot as they tumble back into the living room.", mood: "triumphant", seconds: 5 },
    ],
  },
  {
    match: /./,
    theme: "whimsical fairy-tale adventure",
    title: (lead) => `${lead} and the Enchanted Living Room`,
    artStyle: "hyper-realistic live-action footage, candlelit castle light and soft haze, 35mm lens at eye level, everyone in sharp focus, subtle film grain",
    roles: [
      { role: "knight", name: "Sir Brave-a-Lot", costume: "polished plate armor over a tunic", personality: "brave, but only after a snack" },
      { role: "wizard", name: "Wizard Wobble", costume: "a starry midnight-blue robe and a tall pointed hat", personality: "spells always come out slightly wrong" },
      { role: "lovable villain", name: "Duke Grumbleton", costume: "a black velvet cloak with a dramatic collar", personality: "grumpy because nobody invites them to parties" },
      { role: "queen", name: "Queen Sparkle", costume: "an emerald gown and a glittering crown", personality: "rules with jokes instead of laws" },
      { role: "jester", name: "Jingles", costume: "a patchwork jester suit with bells", personality: "can juggle anything, even soup" },
      { role: "dragon tamer", name: "Ember", costume: "scaled leather armor and fireproof gloves", personality: "speaks fluent dragon" },
    ],
    petRole: { role: "royal steed", name: "Lord Fluffington", costume: "a tiny velvet cape", personality: "the bravest animal in the kingdom" },
    standIns: [
      { role: "owl wizard", name: "Professor Hoot", costume: "a wise grey owl in tiny round spectacles and a starry wizard hat", personality: "spells always come out slightly wrong" },
      { role: "grumpy dragon", name: "Grumbleton", costume: "a small grumpy purple dragon in a velvet cape", personality: "grumpy because nobody invites him to parties" },
    ],
    shots: [
      { say: "The lamp flickered three times, and the living room became a castle.", scene: "{A} looking down in amazement at their new armor in a vast candlelit castle hall, sparkles swirling", motion: "Slow push-in as golden sparkles swirl and {A} raises their gauntlets in wonder.", mood: "dreamy", seconds: 10 },
      { say: "{B} waved the {PROP}. Poof! Out popped a goose wearing a crown.", scene: "{B} mid-spell in a castle courtyard, a burst of colorful smoke, {A} jumping back", motion: "Quick push-in as the smoke clears and a tiny crowned goose waddles out honking.", mood: "funny", seconds: 10 },
      { say: "Then {C} swept in and stole every cupcake in the castle!", scene: "{C} sweeping across a moonlit castle balcony with a sack of cupcakes, cloak flaring", motion: "Low-angle tracking shot as the cloak billows and cupcakes tumble from the sack.", mood: "mysterious", seconds: 5 },
      { say: "Instead of a battle, the heroes held out an invitation. {C} smiled for the first time in years.", scene: "{A} and {B} holding out a scroll to {C} on a lantern-lit forest path", motion: "Gentle orbit as {C} slowly takes the scroll and breaks into a smile.", mood: "cozy", seconds: 10 },
      { say: "That evening, the whole kingdom danced at the grandest party ever.", scene: "{ALL} dancing across a grand castle ballroom with fireworks outside tall windows, towers of cupcakes and floating lanterns", motion: "Camera circles the dancers as they twirl and bump into each other, grinning and laughing.", mood: "triumphant", seconds: 10 },
      { say: "", scene: "{ALL} sitting together on a living room couch at night as golden sparkles drift around them", motion: "Slow pull-back as the sparkles fade and the lamp glows.", mood: "dreamy", seconds: 5 },
    ],
  },
];

function packFor(prompt: string): ThemePack {
  return PACKS.find((p) => p.match.test(prompt)) ?? PACKS[PACKS.length - 1];
}

function positionOf(box: { x: number; w: number }): Position {
  const cx = box.x + box.w / 2;
  if (cx < 0.2) return "far left";
  if (cx < 0.4) return "left";
  if (cx < 0.6) return "center";
  if (cx < 0.8) return "right";
  return "far right";
}

function joinNames(names: string[]): string {
  return names.length === 0 ? "everyone" : names.length === 1 ? names[0] : `${names.slice(0, -1).join(", ")} and ${names.at(-1)}`;
}

function fill(template: string, all: string, a: string, b: string, c: string, prop = "TV remote"): string {
  return template.replaceAll("{A}", a).replaceAll("{B}", b).replaceAll("{C}", c).replaceAll("{ALL}", all).replaceAll("{PROP}", prop);
}

function buildStory(prompt: string, occupants: Occupant[], objects: string[]): Story {
  const pack = packFor(prompt);
  const people = occupants.filter((o) => o.kind === "person");
  const pets = occupants.filter((o) => o.kind === "pet");
  const characters: StoryCharacter[] = [];

  people.slice(0, 6).forEach((o, i) => {
    const r = pack.roles[i % pack.roles.length];
    characters.push({ id: `c${i + 1}`, occupantId: o.id, ...r, playedBy: o.description, accentColor: CHARACTER_PALETTE[i % CHARACTER_PALETTE.length] });
  });
  pets.slice(0, Math.max(0, 6 - characters.length)).forEach((o) => {
    const i = characters.length;
    characters.push({ id: `c${i + 1}`, occupantId: o.id, ...pack.petRole, playedBy: o.description, accentColor: CHARACTER_PALETTE[i % CHARACTER_PALETTE.length] });
  });
  // Every human on screen is someone in the room; empty {B}/{C} slots go to non-human stand-ins.
  if (characters.length === 0) {
    characters.push({ id: "c1", occupantId: null, ...pack.roles[0], playedBy: "", accentColor: CHARACTER_PALETTE[0] });
  }
  const standIns = new Set<string>();
  while (characters.length < 3) {
    const i = characters.length;
    characters.push({ id: `c${i + 1}`, occupantId: null, ...pack.standIns[i - 1], playedBy: "", accentColor: CHARACTER_PALETTE[i] });
    standIns.add(`c${i + 1}`);
  }

  const names = characters.map((c) => c.name);
  // A stand-in is the creature itself ("Robo-Buddy, a knee-high robot"), not a person in costume.
  const dressed = characters.map((c) => (standIns.has(c.id) ? `${c.name}, ${c.costume}` : `${c.name} in ${c.costume}`));
  const who = characters.map((c) => `the ${c.role}`);
  const prop = objects[0] ?? "TV remote";
  const ids = characters.map((c) => c.id);
  const onScreen = (t: ShotTemplate) => {
    if (t.scene.includes("{ALL}")) return ids.slice(0, 4);
    return ids.filter((_, i) => (i === 0 && t.scene.includes("{A}")) || (i === 1 && t.scene.includes("{B}")) || (i === 2 && t.scene.includes("{C}")));
  };

  return {
    id: newStoryId(),
    title: pack.title(names[0]),
    logline: `${joinNames(names.slice(0, 3))} discover the living room is the doorway to a ${pack.theme}.`,
    theme: pack.theme,
    artStyle: pack.artStyle,
    characters,
    shots: pack.shots.map((t) => {
      const cast = onScreen(t);
      return {
        narration: fill(t.say, "everyone", names[0], names[1], names[2], prop),
        imagePrompt: fill(t.scene, joinNames(dressed.slice(0, 4)), dressed[0], dressed[1], dressed[2]),
        motionPrompt: fill(t.motion, "everyone", who[0], who[1], who[2], prop),
        characterIds: cast.length > 0 ? cast : ids.slice(0, 2),
        mood: t.mood,
        seconds: t.seconds,
      };
    }),
  };
}

export function buildMockSceneStory(prompt: string, subjects: SubjectHint[]): SceneAnalysisResponse {
  const ordered = [...subjects].sort((a, b) => a.box.x + a.box.w / 2 - (b.box.x + b.box.w / 2));
  let personN = 0;
  const occupants: Occupant[] = ordered.map((s) => ({
    id: s.id,
    kind: s.kind === "person" ? "person" : "pet",
    description: s.kind === "person" ? `storyteller #${++personN}` : `the ${s.kind}`,
    position: positionOf(s.box),
  }));
  const scene: SceneAnalysis = { setting: "a cozy living room", objects: ["TV remote", "couch cushion", "lamp"], occupants };
  return { scene, story: buildStory(prompt, occupants, scene.objects), mode: "mock" };
}

export function buildMockStory(prompt: string, scene?: SceneAnalysis): Story {
  return buildStory(prompt, scene?.occupants ?? [], scene?.objects ?? ["TV remote"]);
}

/** A fixed film for the player demo. Occupant ids match the demo cast photo, left to right. */
export const MOCK_STORY: Story = {
  id: "story-demo",
  title: "The Great Couch Galaxy",
  logline: "A family discovers their couch is secretly a spaceship.",
  theme: "silly sci-fi",
  artStyle: "hyper-realistic live-action footage, starlight and console glow, 35mm lens at eye level, everyone in sharp focus, subtle film grain",
  characters: [
    { id: "c1", occupantId: "p1", name: "Captain Plaid", role: "captain", playedBy: "man in a red plaid shirt", costume: "a red plaid space suit", personality: "brave, and terrible at parking rockets", accentColor: "#FF6B35" },
    { id: "c2", occupantId: "p2", name: "Engineer Specs", role: "engineer", playedBy: "kid with round glasses", costume: "a navy flight suit with a glowing tool", personality: "can fix anything with tape", accentColor: "#22D3EE" },
    { id: "c3", occupantId: "p3", name: "Commander Nova", role: "pilot", playedBy: "woman in a grey sweater", costume: "a sleek silver flight suit", personality: "calm, until someone touches her snacks", accentColor: "#A78BFA" },
    { id: "c4", occupantId: "pet1", name: "Admiral Biscuit", role: "space pup", playedBy: "golden dog", costume: "a tiny glass space helmet", personality: "wants every tennis ball in the galaxy", accentColor: "#FACC15" },
  ],
  shots: [
    {
      narration: "One ordinary evening, the couch blasted through the ceiling, carrying the whole crew past the moon!",
      imagePrompt: "Captain Plaid in a red plaid space suit, Engineer Specs in a navy flight suit and Commander Nova in a silver flight suit clinging to a couch rocketing past a cratered moon, Admiral Biscuit in a space helmet beside them",
      motionPrompt: "Fast tracking shot alongside the flying couch as it banks past the moon; everyone leans into the turn laughing, the dog's ears flapping.",
      characterIds: ["c1", "c2", "c3", "c4"],
      mood: "exciting",
      seconds: 10,
    },
    {
      narration: "\"Hold on, crew!\" Captain Plaid grabbed the controls while Engineer Specs pressed every button.",
      imagePrompt: "On a spaceship bridge, Captain Plaid in a red plaid space suit striding toward a nebula viewscreen, Engineer Specs leaping with a glowing tool, Commander Nova at the helm, Admiral Biscuit bounding beside them",
      motionPrompt: "Slow dolly in. The captain strides to the window pointing while the engineer slaps glowing buttons and the dog runs circles.",
      characterIds: ["c1", "c2", "c3", "c4"],
      mood: "funny",
      seconds: 10,
    },
    {
      narration: "Outside floated a bubble ship full of every tennis ball in the galaxy.",
      imagePrompt: "Admiral Biscuit in a tiny space helmet with front paws on a spaceship window, staring at a glass bubble ship overflowing with tennis balls in a purple nebula",
      motionPrompt: "Slow push-in past the dog toward the bubble ship as its tail wags faster and faster.",
      characterIds: ["c4"],
      mood: "mysterious",
      seconds: 10,
    },
    {
      narration: "Commander Nova steered alongside as Engineer Specs fired a tractor beam made of tape.",
      imagePrompt: "Commander Nova in a silver flight suit steering at the helm while Engineer Specs in a navy flight suit aims a taped-together glowing tractor beam out of an airlock",
      motionPrompt: "Handheld push as the commander spins the wheel and the beam flickers on, pulling a stream of tennis balls inside.",
      characterIds: ["c3", "c2"],
      mood: "exciting",
      seconds: 10,
    },
    {
      narration: "Together, they returned the tennis balls to every planet. The aliens cheered!",
      imagePrompt: "Captain Plaid in a red plaid space suit, Engineer Specs in a navy flight suit, Commander Nova in a silver flight suit and Admiral Biscuit in a space helmet striding into an alien planet plaza at golden hour, fireworks bursting and tiny aliens cheering",
      motionPrompt: "Slow crane up as the crew runs into the plaza waving, the dog bounding ahead, their faces lighting up as fireworks burst overhead.",
      characterIds: ["c1", "c2", "c3", "c4"],
      mood: "triumphant",
      seconds: 10,
    },
    {
      narration: "The couch landed home just in time for movie night. Everyone shared. Mostly.",
      imagePrompt: "Captain Plaid, Engineer Specs and Commander Nova in their space suits tumbling onto a smoking couch in a cozy living room at night, Admiral Biscuit jumping on them",
      motionPrompt: "Handheld shot settling as the couch thumps down and everyone falls back laughing while the dog licks the captain's face.",
      characterIds: ["c1", "c2", "c3", "c4"],
      mood: "dreamy",
      seconds: 10,
    },
  ],
};
