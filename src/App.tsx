import { memo, useEffect, useMemo, useState } from "react";
import "./App.css";

type GenerationState = {
  story: number; // the index of the story source
  /**
   * A sparse map from line index to sub-story.
   * The line index will always point to a 'LineAsk' instance.
   * The sub-story must provide the given target.
   */
  provide: ReadonlyMap<number, GenerationState>;

  locals: ReadonlyMap<string, string>;
};

function isStateProvided(
  stories: readonly Story[],
  vars: ReadonlyMap<string, GlobalStateValue>,
  state: GenerationState,
  index: number,
): boolean {
  const story = stories[state.story];
  if (!story) {
    return true;
  }
  const word = story[index];
  if (!word) {
    return true;
  }
  if (word.kind !== "ask") {
    return true;
  }
  const key = word.key
    .split("_")
    .map(part => state.locals.get(part) ?? part)
    .join("_");
  return vars.has(key) && vars.get(key)!.provided;
}

function shuffle<T>(items: T[]): void {
  for (let i = 0; i < items.length; i++) {
    const j = i + Math.floor(Math.random() * (items.length - i));
    [items[i], items[j]] = [items[j], items[i]];
  }
}

function* searchForStory(
  stories: readonly Story[],
  current: GenerationState,
  onUpdate: (
    state: GenerationState,
  ) => ReadonlyMap<string, GlobalStateValue> | null,
): Generator<void, GenerationState | null, void> {
  yield;

  const world = onUpdate(current);
  if (!world) {
    // This branch is doomed.
    return null;
  }

  const currentStory = stories[current.story];
  for (let i = 0; i < currentStory.length; i++) {
    yield;
    if (isStateProvided(stories, world, current, i)) {
      // This word is already provided, or does not need to be provided anything.
      continue;
    }
    const word = currentStory[i];
    if (word.kind !== "ask") {
      throw new Error("bug - word is not ask");
    }
    // Find a child story to satisfy it. Recurse!

    const wantKey = word.key
      .split("_")
      .map(part => current.locals.get(part) ?? part);

    const candidates = [];

    for (
      let candidateStoryIndex = 0;
      candidateStoryIndex < stories.length;
      candidateStoryIndex++
    ) {
      yield;
      const candidateStory = stories[candidateStoryIndex];
      // Find a provider.
      candidateWordLoop: for (const candidateProvider of candidateStory) {
        if (candidateProvider.kind === "set" && candidateProvider.provide) {
          // Attempt to match this one against the parent.

          const newKey = candidateProvider.key.split("_");
          if (newKey.length !== wantKey.length) {
            // The keys do not match.
            continue candidateWordLoop;
          }
          const newLocals = new Map<string, string>();
          for (let i = 0; i < newKey.length; i++) {
            if (newKey[i].startsWith("@")) {
              const newLocal = newKey[i];
              if (
                newLocals.has(newLocal) &&
                newLocals.get(newLocal) !== wantKey[i]
              ) {
                continue candidateWordLoop;
              }
              newLocals.set(newLocal, wantKey[i]);
            } else {
              if (newKey[i] !== wantKey[i]) {
                continue candidateWordLoop;
              }
            }
          }

          candidates.push({
            story: candidateStoryIndex,
            newLocals,
          });
        }
      }
    }

    shuffle(candidates);
    for (const candidate of candidates) {
      yield;
      const childState: GenerationState = {
        story: candidate.story,
        locals: candidate.newLocals,
        provide: new Map(),
      };

      const onUpdateChild = (newChild: GenerationState) =>
        onUpdate({
          ...current,
          provide: new Map([...current.provide, [i, newChild] as const]),
        });

      const satisfiedChild = yield* searchForStory(
        stories,
        childState,
        onUpdateChild,
      );
      if (satisfiedChild) {
        const currentWithChild: GenerationState = {
          ...current,
          provide: new Map([...current.provide, [i, childState] as const]),
        };
        yield;
        const finishThisOne = yield* searchForStory(
          stories,
          currentWithChild,
          onUpdate,
        );
        if (finishThisOne) {
          return finishThisOne;
        }
      }
    }
    // This entry cannot be provided successfully.
    return null;
  }

  return current;
}

type WordSet = {
  kind: "set";
  key: string;
  value: string;
  provide: boolean;
};
type WordAsk = {
  kind: "ask";
  key: string;
};
type WordGet = {
  kind: "get";
  key: string;
};
type WordSay = {
  kind: "say";
  text: string;
};

type Word = WordSet | WordAsk | WordGet | WordSay;

type Story = Word[];

function parseStory(text: string): Story {
  const words = text.trim().split(/\s+/);
  return words.map((word): Word => {
    if (word.startsWith("+") || word.startsWith("=")) {
      // Set
      if (word.includes(":")) {
        return {
          kind: "set",
          key: word.slice(1, word.indexOf(":")),
          value: word.slice(word.indexOf(":") + 1),
          provide: word.startsWith("+"),
        };
      } else {
        return {
          kind: "set",
          key: word.slice(1),
          value: "yes",
          provide: word.startsWith("+"),
        };
      }
    }
    if (word.startsWith("?")) {
      return {
        kind: "ask",
        key: word.slice(1),
      };
    }
    if (word.startsWith("$")) {
      return {
        kind: "get",
        key: word.slice(1),
      };
    }
    return { kind: "say", text: word };
  });
}

type GlobalStateValue = { value: string; provided: boolean };

function collectStateInto(
  stories: readonly Story[],
  state: GenerationState,
  target: Map<string, GlobalStateValue>,
): boolean {
  let ok = true;
  const story = stories[state.story];
  for (let i = 0; i < story.length; i++) {
    const word = story[i];
    if (word.kind === "set") {
      const key = word.key
        .split("_")
        .map(part => {
          if (state.locals.has(part)) {
            return state.locals.get(part)!;
          }
          return part;
        })
        .join("_");

      const value = word.value
        .split("_")
        .map(part => {
          if (state.locals.has(part)) {
            return state.locals.get(part)!;
          }
          return part;
        })
        .join("_");

      if (!target.has(key)) {
        target.set(key, { value, provided: false });
      }
      if (target.get(key)!.value !== value) {
        ok = false;
      }
      if (word.provide) {
        target.get(key)!.provided = true;
      }
    }
  }
  for (const child of state.provide.values()) {
    const childOk = collectStateInto(stories, child, target);
    if (!childOk) {
      ok = false;
    }
  }
  return ok;
}

function collectState(
  stories: readonly Story[],
  state: GenerationState,
): [Map<string, GlobalStateValue>, "okay" | "inconsistent"] {
  const target = new Map<string, GlobalStateValue>();
  const ok = collectStateInto(stories, state, target);
  return [target, ok ? "okay" : "inconsistent"];
}

function PresentWord({ word }: { word: Word }) {
  if (word.kind === "set") {
    return (
      <span className="set">
        {word.provide ? "+" : ""}
        {word.key}={word.value}
      </span>
    );
  } else if (word.kind === "ask") {
    return <span className="ask">{word.key} = ???</span>;
  } else if (word.kind === "say") {
    return <span>{word.text}</span>;
  } else if (word.kind === "get") {
    return <span className="get">[{word.key}]</span>;
  }
  throw new Error("unknown word type");
}

function PresentStory({ story }: { story: Story }) {
  const elements: JSX.Element[] = [];
  for (let i = 0; i < story.length; i++) {
    const word = story[i];
    elements.push(<PresentWord key={i} word={word} />);
  }

  return <div className="story">{elements}</div>;
}

const PresentStatePreview = ({
  stories,
  state,
  vars,
}: {
  stories: readonly Story[];
  state: GenerationState;
  vars: ReadonlyMap<string, GlobalStateValue>;
}) => {
  const story = stories[state.story];
  return (
    <div className="story">
      {story.map((word, i) => {
        if (state.provide.has(i)) {
          const child = state.provide.get(i)!;
          return (
            <PresentStatePreview
              key={i}
              stories={stories}
              state={child}
              vars={vars}
            />
          );
        }
        if (
          word.kind === "ask" &&
          vars.has(word.key) &&
          vars.get(word.key)?.provided
        ) {
          return null;
        }
        if (word.kind === "set") {
          return null;
        }
        if (word.kind === "get") {
          if (vars.has(word.key)) {
            return <span key={i}>{vars.get(word.key)!.value}</span>;
          }
        }
        if (word.kind === "say" && state.locals.has(word.text)) {
          return state.locals.get(word.text);
        }
        return <PresentWord key={i} word={word} />;
      })}
    </div>
  );
};

const PresentState = memo(
  ({
    stories,
    state,
    onChange,
    vars,
  }: {
    stories: readonly Story[];
    state: GenerationState;
    onChange: (newState: GenerationState) => void;
    vars: ReadonlyMap<string, GlobalStateValue>;
  }) => {
    const story = stories[state.story];

    const children: JSX.Element[] = [];
    for (let i = 0; i < story.length; i++) {
      const word = story[i];
      if (word.kind === "ask") {
        if (state.provide.has(i)) {
          children.push(
            <div key={i}>
              <hr />
              <div
                style={{ display: "flex", flexDirection: "column", gap: 10 }}
              >
                <div>
                  <PresentWord word={word} />{" "}
                  <button
                    onClick={() => {
                      onChange({
                        ...state,
                        provide: new Map(
                          [...state.provide].filter(v => v[0] !== i),
                        ),
                      });
                    }}
                  >
                    Clear
                  </button>
                </div>

                <PresentState
                  stories={stories}
                  state={state.provide.get(i)!}
                  onChange={newChild => {
                    onChange({
                      ...state,
                      provide: new Map([...state.provide, [i, newChild]]),
                    });
                  }}
                  vars={vars}
                />
              </div>
            </div>,
          );
          continue;
        }

        const options: {
          index: number;
          story: Story;
          locals: Map<string, string>;
        }[] = [];
        for (let j = 0; j < stories.length; j++) {
          const option = stories[j];

          const couldProvide = (
            provideWord: Word,
          ): null | Map<string, string> => {
            if (provideWord.kind === "set" && provideWord.provide) {
              // Compare the key pattern against the desired key.
              const expectedKey = word.key.split("_").map(part => {
                if (part.startsWith("@")) {
                  return state.locals.get(part) ?? "unknown";
                }
                return part;
              });

              const actualKey = provideWord.key.split("_");
              if (actualKey.length !== expectedKey.length) {
                return null;
              }
              const merged = new Map<string, string>();
              for (let i = 0; i < actualKey.length; i++) {
                if (actualKey[i].startsWith("@")) {
                  merged.set(actualKey[i], expectedKey[i]);
                } else if (actualKey[i] !== expectedKey[i]) {
                  return null;
                }
              }

              return merged;
            }
            return null;
          };

          for (const provideWord of option) {
            const map = couldProvide(provideWord);
            if (map) {
              options.push({ index: j, story: option, locals: map });
            }
          }
        }

        if (isStateProvided(stories, vars, state, i)) {
          continue;
        }

        children.push(
          <div key={i}>
            <hr />

            <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
              <div>
                <PresentWord word={word} />
              </div>
              {options.map(option => (
                <div key={option.index} style={{ display: "flex" }}>
                  <button
                    onClick={() => {
                      onChange({
                        ...state,
                        provide: new Map([
                          ...state.provide,
                          [
                            i,
                            {
                              story: option.index,
                              provide: new Map(),
                              locals: option.locals,
                            },
                          ],
                        ]),
                      });
                    }}
                  >
                    Pick
                  </button>
                  <PresentStory story={option.story} />
                </div>
              ))}
            </div>
          </div>,
        );
      }
    }

    return (
      <div className="container">
        <PresentStatePreview
          key="preview"
          stories={stories}
          state={state}
          vars={vars}
        />

        {JSON.stringify([...state.locals])}
        <PresentStory story={story} />
        {children}
      </div>
    );
  },
);

function RandomCompleteState({
  stories,
  state,
  setState,
}: {
  stories: readonly Story[];
  state: GenerationState;
  setState: (newState: GenerationState) => void;
}) {
  const [active, setActive] = useState<Generator<
    void,
    GenerationState | null,
    void
  > | null>(null);

  useEffect(() => {
    let running = true;
    function loop() {
      if (!running) {
        return;
      }
      requestAnimationFrame(loop);
      if (active) {
        const message = active.next();
        if (message.done) {
          setActive(null);
          return;
        }
      }
    }
    loop();
    return () => {
      running = false;
    };
  });

  if (active) {
    return <button onClick={() => setActive(null)}>Stop</button>;
  }

  return (
    <>
      <button
        onClick={() => {
          const onUpdate = (
            state: GenerationState,
          ): ReadonlyMap<string, GlobalStateValue> | null => {
            setState(state);
            const [vars, okay] = collectState(stories, state);
            if (okay === "inconsistent") {
              return null;
            }
            return vars;
          };
          setActive(searchForStory(stories, state, onUpdate));
        }}
      >
        Search
      </button>
      <button
        onClick={() => {
          setState({
            story: 0,
            provide: new Map(),
            locals: new Map(),
          });
        }}
      >
        Clear
      </button>
    </>
  );
}

function ExploreStories({ stories }: { stories: readonly Story[] }) {
  const [state, setState] = useState<GenerationState>({
    story: 0,
    provide: new Map(),
    locals: new Map(),
  });
  const [vars, varsOkay] = collectState(stories, state);

  return (
    <>
      <RandomCompleteState
        stories={stories}
        state={state}
        setState={setState}
      />
      <PresentState
        stories={stories}
        state={state}
        onChange={setState}
        vars={vars}
      />
    </>
  );
}

function useLocalStorage(
  key: string,
  initial: string,
): [string, (newValue: string) => void] {
  const [state, setState] = useState(localStorage.getItem(key) ?? initial);

  useEffect(() => {
    if (localStorage.getItem(key) === null && state === initial) {
      return;
    }
    localStorage.setItem(key, state);
  }, [state, key]);

  return [state, setState];
}

function ChooseStorage() {
  const [storageKey, setStorageKey] = useState("");
  return (
    <>
      <input value={storageKey} onChange={e => setStorageKey(e.target.value)} />
      <App key={storageKey} storageKey={storageKey} />
    </>
  );
}

function App({ storageKey }: { storageKey: string }) {
  const [sourceText, setSourceText] = useLocalStorage(
    "story_rules_" + storageKey,
    ["root ?char_A", "Greetings from +char_@c I am @c"].join("\n\n"),
  );

  const stories = useMemo(() => {
    return sourceText
      .split(/\n\s*\n/)
      .map(stanza => stanza.trim())
      .filter(stanza => stanza)
      .map(parseStory);
  }, [sourceText]);

  return (
    <>
      <div className="story-def-container">
        <textarea
          className="story-def"
          value={sourceText}
          onChange={e => setSourceText(e.target.value)}
        />
      </div>
      {stories.length > 0 && (
        <ExploreStories key={sourceText} stories={stories} />
      )}
    </>
  );
}

export default ChooseStorage;
