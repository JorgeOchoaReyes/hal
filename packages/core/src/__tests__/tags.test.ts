import { test } from "node:test";
import assert from "node:assert/strict";
import { parseAction, validateActionTags, renderAction } from "../index.js";

test("parses text with self-closing and wrapping tags", () => {
  const { segments, errors } = parseAction('Wait <silence time="2s" /> then <spell>AB</spell>');
  assert.deepEqual(errors, []);
  assert.equal(segments.length, 4); // text, silence, text, spell
  assert.equal(segments[1]!.kind, "tag");
});

test("renderAction: silence/hold add delay, endcall detected, dtmf annotated", () => {
  const r = renderAction('Hold on <hold time="3s" /> pressing <dtmf digits="123" /> done <endcall />');
  assert.equal(r.endCall, true);
  assert.equal(r.delayMs, 3000);
  assert.ok(r.effects.includes("dtmf:123"));
  assert.ok(r.text.includes("[pressed 123]"));
});

test("renderAction spells out and keeps regional voice inner text", () => {
  assert.equal(renderAction("code <spell>A1</spell>").text, "code A 1");
  const v = renderAction('<voice provider="11labs" id="abc" text="Hi there" /> ok');
  // self-closing voice with text attribute has no inner; the trailing text remains.
  assert.ok(v.text.includes("ok"));
  assert.ok(v.effects.some((e) => e.startsWith("voice:")));
});

test("validation: whole-action, start-only, followup-only, and required attrs", () => {
  // ivr must be the whole action
  assert.ok(
    validateActionTags('<ivr text="menu" /> hello', { isFollowup: false }).some((e) =>
      e.includes("entire action"),
    ),
  );
  // speed must be at the start
  assert.ok(
    validateActionTags('hello <speed ratio="1.1" />', { isFollowup: false }).some((e) =>
      e.includes("start of the action"),
    ),
  );
  // interruption only on followups
  assert.ok(
    validateActionTags('<interruption time="3s" /> hi', { isFollowup: false }).some((e) =>
      e.includes("action_followup"),
    ),
  );
  assert.deepEqual(validateActionTags('<interruption time="3s" /> hi', { isFollowup: true }), []);
  // missing required attr
  assert.ok(
    validateActionTags("<dtmf />", { isFollowup: false }).some((e) => e.includes('requires the "digits"')),
  );
  // ratio out of range
  assert.ok(
    validateActionTags('<speed ratio="3" />', { isFollowup: false }).some((e) => e.includes("between 0.8 and 1.2")),
  );
});

test("validation flags unsupported tags (functions and friends)", () => {
  for (const tag of ["<function name=\"x\" />", "<audio id=\"g\" />", "<client_message t=\"x\" />", "<network_simulation packet_loss=\"5\" />"]) {
    const errs = validateActionTags(tag, { isFollowup: false });
    assert.ok(errs.some((e) => e.includes("not supported")), `${tag} should be unsupported`);
  }
});
