import { describe, expect, test } from "bun:test";
import { extractThreadDocumentFromPayloads, extractThreadTweetsFromPayloads } from "../adapters/x/thread";

function buildTweet(options: {
  id: string;
  text: string;
  createdAt: string;
  userId?: string;
  screenName?: string;
  name?: string;
  conversationId?: string;
  inReplyToStatusId?: string;
  inReplyToUserId?: string;
  quotedTweet?: unknown;
}) {
  const userId = options.userId ?? "3178231";
  const screenName = options.screenName ?? "dotey";
  const name = options.name ?? "宝玉";

  return {
    __typename: "Tweet",
    rest_id: options.id,
    legacy: {
      id_str: options.id,
      full_text: options.text,
      favorite_count: 0,
      retweet_count: 0,
      reply_count: 0,
      created_at: options.createdAt,
      user_id_str: userId,
      conversation_id_str: options.conversationId ?? options.id,
      in_reply_to_status_id_str: options.inReplyToStatusId,
      in_reply_to_user_id_str: options.inReplyToUserId,
    },
    core: {
      user_results: {
        result: {
          core: {
            name,
            screen_name: screenName,
          },
          legacy: {},
        },
      },
    },
    quoted_status_result: options.quotedTweet
      ? {
          result: options.quotedTweet,
        }
      : undefined,
  };
}

function tweetEntry(tweet: unknown) {
  return {
    content: {
      itemContent: {
        tweet_results: {
          result: tweet,
        },
      },
    },
  };
}

function moduleTweetItem(tweet: unknown) {
  return {
    item: {
      itemContent: {
        tweet_results: {
          result: tweet,
        },
      },
    },
  };
}

describe("x thread extraction", () => {
  test("keeps only the continuous same-author reply chain", () => {
    const rootId = "1996285439867556304";
    const reply1Id = "1996285442275340783";
    const reply2Id = "1996285444582146559";
    const quotedId = "1993729800922341810";
    const quotedInsideThreadId = "1993729800922341811";
    const otherAuthorReplyId = "2000000000000000001";
    const sameAuthorAfterOtherId = "2000000000000000002";

    const root = buildTweet({
      id: rootId,
      text: "A thread for my nana banana pro prompts 🧵",
      createdAt: "Wed Dec 03 18:28:32 +0000 2025",
      conversationId: rootId,
    });
    const reply1 = buildTweet({
      id: reply1Id,
      text: "Prompt 1",
      createdAt: "Wed Dec 03 18:28:33 +0000 2025",
      conversationId: rootId,
      inReplyToStatusId: rootId,
      inReplyToUserId: "3178231",
      quotedTweet: buildTweet({
        id: quotedInsideThreadId,
        text: "Quoted inside the thread body",
        createdAt: "Tue Nov 25 18:28:35 +0000 2025",
        screenName: "quoted_author",
        name: "Quoted Author",
      }),
    });
    const reply2 = buildTweet({
      id: reply2Id,
      text: "Prompt 2",
      createdAt: "Wed Dec 03 18:28:34 +0000 2025",
      conversationId: rootId,
      inReplyToStatusId: reply1Id,
      inReplyToUserId: "3178231",
    });
    const quotedSameAuthor = buildTweet({
      id: quotedId,
      text: "Quoted standalone tweet",
      createdAt: "Tue Nov 25 18:28:34 +0000 2025",
    });
    const otherAuthorReply = buildTweet({
      id: otherAuthorReplyId,
      text: "Another author joined the conversation",
      createdAt: "Wed Dec 03 18:28:35 +0000 2025",
      userId: "42",
      screenName: "someone_else",
      name: "Someone Else",
      conversationId: rootId,
      inReplyToStatusId: reply2Id,
      inReplyToUserId: "3178231",
    });
    const sameAuthorAfterOther = buildTweet({
      id: sameAuthorAfterOtherId,
      text: "This should not be part of the continuous author chain",
      createdAt: "Wed Dec 03 18:28:36 +0000 2025",
      conversationId: rootId,
      inReplyToStatusId: otherAuthorReplyId,
      inReplyToUserId: "42",
    });

    const payloads = [
      {
        data: {
          threaded_conversation_with_injections_v2: {
            instructions: [
              {
                type: "TimelineAddEntries",
                entries: [
                  tweetEntry(root),
                  tweetEntry(reply1),
                  tweetEntry(quotedSameAuthor),
                  {
                    content: {
                      items: [moduleTweetItem(reply2)],
                    },
                  },
                ],
              },
              {
                type: "TimelineAddToModule",
                moduleItems: [moduleTweetItem(otherAuthorReply), moduleTweetItem(sameAuthorAfterOther)],
              },
            ],
          },
        },
      },
    ];

    const tweets = extractThreadTweetsFromPayloads(
      payloads,
      rootId,
      "https://x.com/dotey/status/1996285439867556304",
    );

    expect(tweets.map((tweet) => tweet.id)).toEqual([rootId, reply1Id, reply2Id]);

    const document = extractThreadDocumentFromPayloads(
      payloads,
      rootId,
      "https://x.com/dotey/status/1996285439867556304",
    );

    expect(document).not.toBeNull();
    expect(document?.metadata?.tweetCount).toBe(3);
    expect(document?.metadata?.lastTweetId).toBe(reply2Id);

    const content = document?.content[0];
    expect(content?.type).toBe("markdown");
    if (!content || content.type !== "markdown") {
      throw new Error("Expected markdown content");
    }

    expect(content.markdown).toContain("Prompt 1");
    expect(content.markdown).toContain("Prompt 2");
    expect(content.markdown).toContain("Quoted inside the thread body");
    expect(content.markdown).not.toContain("Quoted standalone tweet");
    expect(content.markdown).not.toContain("This should not be part of the continuous author chain");
  });

  test("returns null when there is no same-author reply chain", () => {
    const rootId = "1996285439867556304";
    const root = buildTweet({
      id: rootId,
      text: "Root tweet",
      createdAt: "Wed Dec 03 18:28:32 +0000 2025",
      conversationId: rootId,
    });
    const quotedSameAuthor = buildTweet({
      id: "1993729800922341810",
      text: "Quoted standalone tweet",
      createdAt: "Tue Nov 25 18:28:34 +0000 2025",
    });

    const payloads = [
      {
        data: {
          threaded_conversation_with_injections_v2: {
            instructions: [
              {
                type: "TimelineAddEntries",
                entries: [tweetEntry(root), tweetEntry(quotedSameAuthor)],
              },
            ],
          },
        },
      },
    ];

    expect(
      extractThreadDocumentFromPayloads(
        payloads,
        rootId,
        "https://x.com/dotey/status/1996285439867556304",
      ),
    ).toBeNull();
  });

  test("restores ancestors when the requested tweet is in the middle of a thread", () => {
    const rootId = "1996285439867556304";
    const reply1Id = "1996285442275340783";
    const reply2Id = "1996285444582146559";

    const root = buildTweet({
      id: rootId,
      text: "Root tweet",
      createdAt: "Wed Dec 03 18:28:32 +0000 2025",
      conversationId: rootId,
    });
    const reply1 = buildTweet({
      id: reply1Id,
      text: "Middle tweet",
      createdAt: "Wed Dec 03 18:28:33 +0000 2025",
      conversationId: rootId,
      inReplyToStatusId: rootId,
      inReplyToUserId: "3178231",
    });
    const reply2 = buildTweet({
      id: reply2Id,
      text: "Last tweet",
      createdAt: "Wed Dec 03 18:28:34 +0000 2025",
      conversationId: rootId,
      inReplyToStatusId: reply1Id,
      inReplyToUserId: "3178231",
    });

    const payloads = [
      {
        data: {
          threaded_conversation_with_injections_v2: {
            instructions: [
              {
                type: "TimelineAddEntries",
                entries: [
                  tweetEntry(root),
                  tweetEntry(reply1),
                  tweetEntry(reply2),
                ],
              },
            ],
          },
        },
      },
    ];

    const tweets = extractThreadTweetsFromPayloads(
      payloads,
      reply1Id,
      "https://x.com/dotey/status/1996285442275340783",
    );

    expect(tweets.map((tweet) => tweet.id)).toEqual([rootId, reply1Id, reply2Id]);

    const document = extractThreadDocumentFromPayloads(
      payloads,
      reply1Id,
      "https://x.com/dotey/status/1996285442275340783",
    );

    expect(document).not.toBeNull();
    expect(document?.metadata?.tweetId).toBe(rootId);
    expect(document?.metadata?.lastTweetId).toBe(reply2Id);
    expect(document?.metadata?.tweetCount).toBe(3);
  });
});
