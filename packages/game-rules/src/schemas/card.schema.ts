import { z } from 'zod';
import { CardType, ElementAttribute, SignalOrbType } from '@zhanshuang/shared';

export const CardTypeSchema = z.nativeEnum(CardType);
export const ElementAttributeSchema = z.nativeEnum(ElementAttribute);
export const SignalOrbTypeSchema = z.nativeEnum(SignalOrbType);

export const CardInputSchema = z.object({
  cardNumber: z.string().min(1, '卡牌编号不能为空'),
  name: z.string().min(1, '卡牌名称不能为空'),
  cardType: CardTypeSchema,
  attribute: ElementAttributeSchema,
  cost: z.number().int().min(0, '费用不能为负数'),
  basePP: z.number().int().min(0).optional().nullable(),
  baseDP: z.number().int().min(0).optional().nullable(),
  signalOrb: SignalOrbTypeSchema.optional().nullable(),
  traits: z.array(z.string()).default([]),
  isInstant: z.boolean().default(false),
  imageUrl: z.string().url().optional().nullable().or(z.literal('')),
  rulesText: z.string().default(''),
  flavorText: z.string().optional().nullable(),
});

export const CardBatchImportSchema = z.array(CardInputSchema);

export type CardInput = z.infer<typeof CardInputSchema>;
