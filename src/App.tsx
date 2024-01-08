import { memo, useEffect, useMemo, useState } from "react";
import "./App.css";
import { unifyKeys } from "./unify";
import { useLocalStorage } from "./useLocalStorage";

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
  const currentStory = stories[current.story];

  if (!world) {
    // This branch is doomed.
    return null;
  }

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

    type Candidate = {
      story: number;
      newLocals: ReadonlyMap<string, string>;
    };
    let candidates: Candidate[] = [];

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
            yield;
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

    // If any candidate includes 'search' entries, it must be processed separately.
    const searchedCandidates: Candidate[] = [];
    function* completeCandidate(
      candidate: Candidate,
      index: number,
    ): Generator<void, Candidate[], void> {
      yield;
      const story = stories[candidate.story];
      if (index >= story.length) {
        return [candidate];
      }
      if (world === null) {
        throw new Error("no");
      }
      const word = story[index];
      if (word.kind === "forbid") {
        const key = word.key
          .split("_")
          .map(k => candidate.newLocals.get(k) ?? k)
          .join("_");
        const value = word.value
          .split("_")
          .map(k => candidate.newLocals.get(k) ?? k)
          .join("_");

        if (value === "*") {
          if (world.has(key) && world.get(key)!.value !== "no") {
            return [];
          }
        } else if (value === "no") {
          // ... unclear what to do here
        } else if (world.has(key) && world.get(key)?.value === value) {
          return [];
        }
      }
      if (word.kind === "search") {
        // Process this search!
        // TODO: Make a fast path
        const combined: Candidate[] = [];
        for (const [worldKey, worldValue] of world) {
          yield;
          if (!worldValue.provided) {
            continue; // Must be provided.
          }
          const updatedStateKey = unifyKeys(
            worldKey,
            word.key,
            candidate.newLocals,
          );
          if (updatedStateKey === null) {
            // This world key is incompatible with this search command.
            continue;
          }

          const updatedStateValue = unifyKeys(
            worldValue.value,
            word.value,
            updatedStateKey,
          );
          if (updatedStateValue === null) {
            // The world value is incompatible.
            continue;
          }

          combined.push(
            ...(yield* completeCandidate(
              {
                story: candidate.story,
                newLocals: updatedStateValue,
              },
              index + 1,
            )),
          );
        }
        return combined;
      } else {
        return yield* completeCandidate(candidate, index + 1);
      }
    }
    yield;
    for (const candidate of candidates) {
      yield;
      searchedCandidates.push(...(yield* completeCandidate(candidate, 0)));
    }
    candidates = searchedCandidates;

    shuffle(candidates);
    candidates.sort((a, b) => {
      const sa = stories[a.story];
      const sb = stories[b.story];

      const pa =
        -10 * sa.filter(q => q.kind === "say" && q.text === "*low").length +
        10 * sa.filter(q => q.kind === "say" && q.text === "*high").length;
      const pb =
        -10 * sb.filter(q => q.kind === "say" && q.text === "*low").length +
        10 * sb.filter(q => q.kind === "say" && q.text === "*high").length;

      return pb - pa;
    });
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
          provide: new Map([...current.provide, [i, satisfiedChild] as const]),
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
    yield;
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
type WordSearch = {
  kind: "search";
  key: string;
  value: string;
};
type WordForbid = {
  kind: "forbid";
  key: string;
  value: string;
};

type Word = WordSet | WordAsk | WordGet | WordSay | WordSearch | WordForbid;

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
    if (word.startsWith("&")) {
      if (word.includes(":")) {
        return {
          kind: "search",
          key: word.slice(1, word.indexOf(":")),
          value: word.slice(word.indexOf(":") + 1),
        };
      }
      return {
        kind: "search",
        key: word.slice(1),
        value: "*",
      };
    }
    if (word.startsWith("!")) {
      if (word.includes(":")) {
        return {
          kind: "forbid",
          key: word.slice(1, word.indexOf(":")),
          value: word.slice(word.indexOf(":") + 1),
        };
      } else {
        return {
          kind: "forbid",
          key: word.slice(1),
          value: "*",
        };
      }
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
        if (target.get(key)!.provided) {
          // Cannot provide the same thing twice.
          ok = false;
        }
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
      <>
        <span className="set">
          {word.provide ? "+" : ""}
          {word.key}={word.value}
        </span>{" "}
      </>
    );
  } else if (word.kind === "ask") {
    return (
      <>
        <span className="ask">?{word.key}</span>{" "}
      </>
    );
  } else if (word.kind === "say") {
    if (word.text === "br") {
      return <br />;
    }
    return <span>{word.text} </span>;
  } else if (word.kind === "get") {
    return (
      <>
        <span className="get">[{word.key}]</span>{" "}
      </>
    );
  } else if (word.kind === "search") {
    return (
      <>
        <span className="search">
          &{word.key}:{word.value}
        </span>{" "}
      </>
    );
  } else if (word.kind === "forbid") {
    return (
      <>
        <span className="search">
          !{word.key}:{word.value}
        </span>{" "}
      </>
    );
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
  const flattenWords = (state: GenerationState): Word[] => {
    const story = stories[state.story];
    return story.flatMap((word, index) => {
      if (state.provide.has(index)) {
        return flattenWords(state.provide.get(index)!);
      }

      if (word.kind === "say" && state.locals.has(word.text)) {
        return [
          {
            kind: "say",
            text: state.locals.get(word.text)!,
          },
        ];
      }

      if (word.kind === "get") {
        return [
          {
            kind: "get",
            key: word.key
              .split("_")
              .map(part => state.locals.get(part) ?? part)
              .join("_"),
          },
        ];
      }

      return [word];
    });
  };

  const words = flattenWords(state);

  return (
    <div className="story">
      {words.map((word, i) => {
        if (
          word.kind === "ask" &&
          vars.has(word.key) &&
          vars.get(word.key)?.provided
        ) {
          return null;
        }
        if (
          word.kind === "set" ||
          word.kind === "search" ||
          word.kind === "forbid" ||
          (word.kind === "say" && word.text.startsWith("*"))
        ) {
          return null;
        }
        if (word.kind === "get") {
          const key = word.key
            .split("_")
            .map(part => state.locals.get(part) ?? part)
            .join("_");
          if (vars.has(key)) {
            return <span key={i}>{vars.get(key)!.value}</span>;
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

const PresentLocals = memo(
  ({ locals }: { locals: ReadonlyMap<string, string> }) => {
    if (locals.size === 0) {
      return null;
    }

    return (
      <div className="locals">
        {[...locals].map(([key, value]) => (
          <div key={key}>
            <code>{key}</code>: <code>{value}</code>
          </div>
        ))}
      </div>
    );
  },
);

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
                    style={{ fontSize: "200%" }}
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
                    style={{ fontSize: "200%" }}
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
        <PresentLocals locals={state.locals} />

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
        const begin = Date.now();
        while (true) {
          const message = active.next();
          if (message.done) {
            if (message.value) {
              setState(message.value);
            }
            setActive(null);
            return;
          }
          if (Date.now() > begin + 30) {
            break;
          }
        }
      }
    }
    loop();
    return () => {
      running = false;
    };
  });

  if (active) {
    return (
      <button style={{ fontSize: "200%" }} onClick={() => setActive(null)}>
        Stop
      </button>
    );
  }

  return (
    <div className="button-row">
      <button
        style={{ fontSize: "200%" }}
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
        style={{ fontSize: "200%" }}
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
    </div>
  );
}

function ExploreStories({ stories }: { stories: readonly Story[] }) {
  const [state, setState] = useState<GenerationState>({
    story: 0,
    provide: new Map(),
    locals: new Map(),
  });
  const [vars, varsOkay] = collectState(stories, state);

  const [showDetail, setShowDetail] = useState(false);

  return (
    <>
      <RandomCompleteState
        stories={stories}
        state={state}
        setState={setState}
      />
      <details>
        <summary>
          State <code>{varsOkay}</code>
        </summary>
        <div>
          {varsOkay}
          <ul>
            {[...vars].map(([k, v]) => (
              <li key={k}>
                {k}: {v.value} {v.provided ? "+" : ""}
              </li>
            ))}
          </ul>
        </div>
      </details>

      <button onClick={() => setShowDetail(!showDetail)}>Detail</button>
      {showDetail && (
        <PresentState
          stories={stories}
          state={state}
          onChange={setState}
          vars={vars}
        />
      )}
      {!showDetail && (
        <PresentStatePreview stories={stories} state={state} vars={vars} />
      )}
    </>
  );
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

function useDebounce<T>(x: T, { settleMs }: { settleMs: number }): T {
  const [current, setCurrent] = useState(x);

  useEffect(() => {
    const timeout = setTimeout(() => {
      setCurrent(x);
    }, settleMs);
    return () => {
      clearTimeout(timeout);
    };
  }, [x, settleMs]);

  return current;
}

function App({ storageKey }: { storageKey: string }) {
  const [actualSourceText, setSourceText] = useLocalStorage(
    "story_rules_" + storageKey,
    ["root ?char_A", "Greetings from +char_@c I am @c"].join("\n\n"),
    { delayMs: 2000 },
  );

  const sourceText = useDebounce(actualSourceText, { settleMs: 1500 });

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
          value={actualSourceText}
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
