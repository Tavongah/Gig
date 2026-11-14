import { WhatsAppConversationState } from "@prisma/client";
import { formatMainMenu } from "../whatsapp/copy.js";
import { updateConversation, type ConversationContext } from "../whatsapp/conversation.service.js";
import { getWhatsAppProvider } from "../whatsapp/provider.js";
import { isProtectedWhatsAppTransaction, hasActiveCheckoutBasket } from "../whatsapp/checkout-session.js";
import { normalizeContactPhone, reduceCrossBorderDraft, shouldEnterCrossBorder, type WaDraft } from "./domain.js";
import { crossBorderEnabled } from "./flag.js";
import { createCrossBorderRequest, newDraftId } from "./request.service.js";

type StoredDraft = WaDraft;

function readDraft(ctx: ConversationContext): StoredDraft | null {
  const value = ctx.crossBorder;
  if (!value?.active) return null;
  return value;
}

export async function tryHandleCrossBorderWhatsApp(input: {
  phone: string;
  conversationId: string;
  ctx: ConversationContext;
  text: string;
}): Promise<{ handled: boolean }> {
  const draft = readDraft(input.ctx);
  const enter = shouldEnterCrossBorder({
    enabled: crossBorderEnabled(),
    text: input.text,
    draftActive: Boolean(draft),
    protectedTransaction: isProtectedWhatsAppTransaction(input.ctx),
    expectedInput: input.ctx.expectedInput,
    hasBasket: hasActiveCheckoutBasket(input.ctx)
  });
  if (!enter) return { handled: false };

  const phone = normalizeContactPhone(input.phone) ?? input.phone;
  const next = reduceCrossBorderDraft(draft, input.text, phone, draft?.draftId ?? newDraftId());
  if (next.exitToMenu) {
    const ctx = { ...input.ctx, crossBorder: undefined };
    await updateConversation(input.conversationId, { state: WhatsAppConversationState.IDLE, context: ctx });
    await getWhatsAppProvider().sendText(input.phone, `${next.reply}${formatMainMenu()}`);
    return { handled: true };
  }
  if (next.submit) {
    let created: Awaited<ReturnType<typeof createCrossBorderRequest>>;
    try {
      created = await createCrossBorderRequest({
      ...next.submit,
      phone: next.submit.phone ?? phone,
      source: "WHATSAPP",
      whatsappIdempotencyKey: `${phone}:${next.submit.draftId}`
    });
    } catch (error) {
      const message = error instanceof Error ? error.message : "The request was not saved.";
      await getWhatsAppProvider().sendText(input.phone, `${message} Reply menu to cancel.`);
      return { handled: true };
    }
    const ctx = { ...input.ctx, crossBorder: undefined };
    await updateConversation(input.conversationId, { state: WhatsAppConversationState.IDLE, context: ctx });
    await getWhatsAppProvider().sendText(
      input.phone,
      created.replay
        ? `Your South African shopping request is already ${created.request.reference}.`
        : `${created.message} Reply menu to return to local shopping.`
    );
    return { handled: true };
  }
  const ctx = { ...input.ctx, crossBorder: next.draft ?? undefined };
  await updateConversation(input.conversationId, { context: ctx });
  if (next.reply) await getWhatsAppProvider().sendText(input.phone, next.reply);
  return { handled: true };
}
