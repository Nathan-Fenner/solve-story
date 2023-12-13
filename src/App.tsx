import { memo, useState } from "react";
import reactLogo from "./assets/react.svg";
import viteLogo from "/vite.svg";
import "./App.css";

type GenerationState = {
  story: number; // the index of the story source
  /**
   * A sparse map from line index to sub-story.
   * The line index will always point to a 'LineAsk' instance.
   * The sub-story must provide the given target.
   */
  provide: ReadonlyMap<number, GenerationState>;
};

type WordSet = {
  kind: "set";
  key: string;
  value: string;
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
    if (word.startsWith("+")) {
      // Set
      if (word.includes(":")) {
        return {
          kind: "set",
          key: word.slice(1, word.indexOf(":")),
          value: word.slice(word.indexOf(":") + 1),
        };
      } else {
        return { kind: "set", key: word.slice(1), value: "yes" };
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

const STORIES_TEXT = [
  "once upon a time, there was a ?hero who saved the ?royalty $royalty",
  "+hero a shining knight ?curse",
  "+hero a plucky peasant",
  "+curse cursed to become a frog",
  "+royalty:queen",
  "+royalty:king",
  "+royalty:princess",
  "+royalty:prince",
];

const STORIES = STORIES_TEXT.map(parseStory);

function PresentWord({ word }: { word: Word }) {
  if (word.kind === "set") {
    return (
      <span className="set">
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

const PresentState = memo(
  ({
    stories,
    state,
    onChange,
  }: {
    stories: readonly Story[];
    state: GenerationState;
    onChange: (newState: GenerationState) => void;
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
                  <PresentWord word={word} />
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
                />
              </div>
            </div>,
          );
          continue;
        }

        const options: { index: number; story: Story }[] = [];
        for (let j = 0; j < stories.length; j++) {
          const option = stories[j];
          if (option.find(w => w.kind === "set" && w.key === word.key)) {
            options.push({ index: j, story: option });
          }
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
        <PresentStory story={story} />
        {children}
      </div>
    );
  },
);

function App() {
  const [state, setState] = useState<GenerationState>({
    story: 0,
    provide: new Map(),
  });

  return (
    <>
      <PresentState stories={STORIES} state={state} onChange={setState} />
    </>
  );
}

export default App;
