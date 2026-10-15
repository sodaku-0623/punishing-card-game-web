/**
 * 官方预组 (ST01~ST03) 权威卡表。
 * 前端 (选择出战卡组、卡组构筑器) 与服务端 (Cloudflare Worker 开局) 共用同一份数据，
 * 服务端开局时一律以此为准，忽略客户端上传的预组卡表。
 */
export interface StarterDeckCard {
  cardId: string;
  cardNumber: string;
  name: string;
  count: number;
  imageUrl: string;
  variantKey?: string;
  variantBadge?: string;
  variantStar?: number;
}

export interface StarterDeck {
  id: string;
  name: string;
  description: string;
  cards: StarterDeckCard[];
  coverImage?: string;
  createdAt: number;
  isOfficial?: boolean;
}

export const OFFICIAL_STARTER_DECKS: StarterDeck[] = [
  {
    id: "deck-1791110685763",
    name: "灰鸦小队·官方预组 (ST01)",
    description: "以露西亚·红莲为核心的物理爆发与手牌检索战术构筑。",
    cards: [
      {
        cardId: "c-st01-001_ST01-R_ST01-001R★★",
        cardNumber: "ST01-001",
        name: "露西亚·红莲",
        count: 1,
        imageUrl: "/cards/ST01-R_ST01-001R★★.png",
        variantKey: "ST01-R_ST01-001R★★",
        variantBadge: "2★ 典藏",
        variantStar: 2
      },
      {
        cardId: "c-st01-001_ST01-R_ST01-001R★",
        cardNumber: "ST01-001",
        name: "露西亚·红莲",
        count: 1,
        imageUrl: "/cards/ST01-R_ST01-001R★.png",
        variantKey: "ST01-R_ST01-001R★",
        variantBadge: "1★ 闪卡",
        variantStar: 1
      },
      {
        cardId: "c-st01-002_ST01-R_ST01-002R★",
        cardNumber: "ST01-002",
        name: "里·异火",
        count: 4,
        imageUrl: "/cards/ST01-R_ST01-002R★.png",
        variantKey: "ST01-R_ST01-002R★",
        variantBadge: "1★ 闪卡",
        variantStar: 1
      },
      {
        cardId: "c-st01-003_ST01-R_ST01-003R★",
        cardNumber: "ST01-003",
        name: "丽芙·蚀暗",
        count: 4,
        imageUrl: "/cards/ST01-R_ST01-003R★.png",
        variantKey: "ST01-R_ST01-003R★",
        variantBadge: "1★ 闪卡",
        variantStar: 1
      },
      {
        cardId: "c-st01-004_ST01-ST_ST01-004ST",
        cardNumber: "ST01-004",
        name: "露西亚·红莲",
        count: 4,
        imageUrl: "/cards/ST01-ST_ST01-004ST.png",
        variantKey: "ST01-ST_ST01-004ST",
        variantBadge: "ST 原画",
        variantStar: 0
      },
      {
        cardId: "c-st01-005_ST01-ST_ST01-005ST",
        cardNumber: "ST01-005",
        name: "露西亚·红莲",
        count: 4,
        imageUrl: "/cards/ST01-ST_ST01-005ST.png",
        variantKey: "ST01-ST_ST01-005ST",
        variantBadge: "ST 原画",
        variantStar: 0
      },
      {
        cardId: "c-st01-006_ST01-ST_ST01-006ST",
        cardNumber: "ST01-006",
        name: "露西亚·红莲",
        count: 4,
        imageUrl: "/cards/ST01-ST_ST01-006ST.png",
        variantKey: "ST01-ST_ST01-006ST",
        variantBadge: "ST 原画",
        variantStar: 0
      },
      {
        cardId: "c-st01-007_ST01-ST_ST01-007ST",
        cardNumber: "ST01-007",
        name: "里·异火",
        count: 4,
        imageUrl: "/cards/ST01-ST_ST01-007ST.png",
        variantKey: "ST01-ST_ST01-007ST",
        variantBadge: "ST 原画",
        variantStar: 0
      },
      {
        cardId: "c-st01-008_ST01-ST_ST01-008ST",
        cardNumber: "ST01-008",
        name: "丽芙·蚀暗",
        count: 2,
        imageUrl: "/cards/ST01-ST_ST01-008ST.png",
        variantKey: "ST01-ST_ST01-008ST",
        variantBadge: "ST 原画",
        variantStar: 0
      },
      {
        cardId: "c-st01-009_ST01-ST_ST01-009ST",
        cardNumber: "ST01-009",
        name: "阿呆蛙与铃铛羊",
        count: 2,
        imageUrl: "/cards/ST01-ST_ST01-009ST.png",
        variantKey: "ST01-ST_ST01-009ST",
        variantBadge: "ST 原画",
        variantStar: 0
      },
      {
        cardId: "c-st01-010_ST01-ST_ST01-010ST",
        cardNumber: "ST01-010",
        name: "灰鸦小队，集合！",
        count: 4,
        imageUrl: "/cards/ST01-ST_ST01-010ST.png",
        variantKey: "ST01-ST_ST01-010ST",
        variantBadge: "ST 原画",
        variantStar: 0
      },
      {
        cardId: "c-st01-011_ST01-ST_ST01-011ST",
        cardNumber: "ST01-011",
        name: "重逢",
        count: 4,
        imageUrl: "/cards/ST01-ST_ST01-011ST.png",
        variantKey: "ST01-ST_ST01-011ST",
        variantBadge: "ST 原画",
        variantStar: 0
      },
      {
        cardId: "c-st01-012_ST01-ST_ST01-012ST",
        cardNumber: "ST01-012",
        name: "红莲-起手式",
        count: 4,
        imageUrl: "/cards/ST01-ST_ST01-012ST.png",
        variantKey: "ST01-ST_ST01-012ST",
        variantBadge: "ST 原画",
        variantStar: 0
      },
      {
        cardId: "c-st01-013_ST01-ST_ST01-013ST",
        cardNumber: "ST01-013",
        name: "红莲-波动斩",
        count: 4,
        imageUrl: "/cards/ST01-ST_ST01-013ST.png",
        variantKey: "ST01-ST_ST01-013ST",
        variantBadge: "ST 原画",
        variantStar: 0
      },
      {
        cardId: "c-st01-014_ST01-ST_ST01-014ST",
        cardNumber: "ST01-014",
        name: "红莲-闪击",
        count: 4,
        imageUrl: "/cards/ST01-ST_ST01-014ST.png",
        variantKey: "ST01-ST_ST01-014ST",
        variantBadge: "ST 原画",
        variantStar: 0
      }
    ],
    coverImage: "/cards/ST01-R_ST01-001R★★.png",
    createdAt: 1791110685763,
    isOfficial: true
  },
  {
    id: "deck-st02",
    name: "升格者·官方预组 (ST02)",
    description: "以露娜·银冕为核心的暗属性墓地苏生与高侵蚀削减战术构筑。",
    cards: [
      {
        cardId: "c-st02-011_ST02-R_ST02-011R★",
        cardNumber: "ST02-011",
        name: "筛选开始",
        count: 4,
        imageUrl: "/cards/ST02-R_ST02-011R★.png",
        variantKey: "ST02-R_ST02-011R★",
        variantBadge: "1★ 闪卡",
        variantStar: 1
      },
      {
        cardId: "c-st02-010_ST02-R_ST02-010R★",
        cardNumber: "ST02-010",
        name: "刹那制裁",
        count: 4,
        imageUrl: "/cards/ST02-R_ST02-010R★.png",
        variantKey: "ST02-R_ST02-010R★",
        variantBadge: "1★ 闪卡",
        variantStar: 1
      },
      {
        cardId: "c-st02-005_ST02-ST_ST02-005ST",
        cardNumber: "ST02-005",
        name: "露娜·银冕",
        count: 4,
        imageUrl: "/cards/ST02-ST_ST02-005ST.png",
        variantKey: "ST02-ST_ST02-005ST",
        variantBadge: "ST 原画",
        variantStar: 0
      },
      {
        cardId: "c-st02-004_ST02-ST_ST02-004ST",
        cardNumber: "ST02-004",
        name: "露娜·银冕",
        count: 4,
        imageUrl: "/cards/ST02-ST_ST02-004ST.png",
        variantKey: "ST02-ST_ST02-004ST",
        variantBadge: "ST 原画",
        variantStar: 0
      },
      {
        cardId: "c-st02-001_ST02-R_ST02-001R★★",
        cardNumber: "ST02-001",
        name: "露娜·银冕",
        count: 1,
        imageUrl: "/cards/ST02-R_ST02-001R★★.png",
        variantKey: "ST02-R_ST02-001R★★",
        variantBadge: "2★ 典藏",
        variantStar: 2
      },
      {
        cardId: "c-st02-001_ST02-R_ST02-001R★",
        cardNumber: "ST02-001",
        name: "露娜·银冕",
        count: 3,
        imageUrl: "/cards/ST02-R_ST02-001R★.png",
        variantKey: "ST02-R_ST02-001R★",
        variantBadge: "1★ 闪卡",
        variantStar: 1
      },
      {
        cardId: "c-st02-003_ST02-ST_ST02-003ST",
        cardNumber: "ST02-003",
        name: "露娜·银冕",
        count: 4,
        imageUrl: "/cards/ST02-ST_ST02-003ST.png",
        variantKey: "ST02-ST_ST02-003ST",
        variantBadge: "ST 原画",
        variantStar: 0
      },
      {
        cardId: "c-st02-007_ST02-ST_ST02-007ST",
        cardNumber: "ST02-007",
        name: "不明构造体α",
        count: 4,
        imageUrl: "/cards/ST02-ST_ST02-007ST.png",
        variantKey: "ST02-ST_ST02-007ST",
        variantBadge: "ST 原画",
        variantStar: 0
      },
      {
        cardId: "c-st02-009_ST02-ST_ST02-009ST",
        cardNumber: "ST02-009",
        name: "奥兹玛",
        count: 2,
        imageUrl: "/cards/ST02-ST_ST02-009ST.png",
        variantKey: "ST02-ST_ST02-009ST",
        variantBadge: "ST 原画",
        variantStar: 0
      },
      {
        cardId: "c-st02-006_ST02-ST_ST02-006ST",
        cardNumber: "ST02-006",
        name: "露娜·银冕",
        count: 4,
        imageUrl: "/cards/ST02-ST_ST02-006ST.png",
        variantKey: "ST02-ST_ST02-006ST",
        variantBadge: "ST 原画",
        variantStar: 0
      },
      {
        cardId: "c-st02-002_ST02-ST_ST02-002ST",
        cardNumber: "ST02-002",
        name: "露娜·银冕",
        count: 2,
        imageUrl: "/cards/ST02-ST_ST02-002ST.png",
        variantKey: "ST02-ST_ST02-002ST",
        variantBadge: "ST 原画",
        variantStar: 0
      },
      {
        cardId: "c-st02-008_ST02-ST_ST02-008ST",
        cardNumber: "ST02-008",
        name: "苦刑之女",
        count: 2,
        imageUrl: "/cards/ST02-ST_ST02-008ST.png",
        variantKey: "ST02-ST_ST02-008ST",
        variantBadge: "ST 原画",
        variantStar: 0
      },
      {
        cardId: "c-st02-012_ST02-ST_ST02-012ST",
        cardNumber: "ST02-012",
        name: "涡旋极星",
        count: 4,
        imageUrl: "/cards/ST02-ST_ST02-012ST.png",
        variantKey: "ST02-ST_ST02-012ST",
        variantBadge: "ST 原画",
        variantStar: 0
      },
      {
        cardId: "c-st02-013_ST02-ST_ST02-013ST",
        cardNumber: "ST02-013",
        name: "南十字星",
        count: 4,
        imageUrl: "/cards/ST02-ST_ST02-013ST.png",
        variantKey: "ST02-ST_ST02-013ST",
        variantBadge: "ST 原画",
        variantStar: 0
      },
      {
        cardId: "c-st02-014_ST02-ST_ST02-014ST",
        cardNumber: "ST02-014",
        name: "苦难咫尺",
        count: 4,
        imageUrl: "/cards/ST02-ST_ST02-014ST.png",
        variantKey: "ST02-ST_ST02-014ST",
        variantBadge: "ST 原画",
        variantStar: 0
      }
    ],
    coverImage: "/cards/ST02-ST_ST02-005ST.png",
    createdAt: 1791110812006,
    isOfficial: true
  },
  {
    id: "deck-st03",
    name: "三头犬小队·官方预组 (ST03)",
    description: "以薇拉·瑰丽为统帅的三头犬协同连击与战术控场构筑。",
    cards: [
      {
        cardId: "c-st03-001_ST03-R_ST03-001R★★",
        cardNumber: "ST03-001",
        name: "薇拉·瑰丽",
        count: 1,
        imageUrl: "/cards/ST03-R_ST03-001R★★.png",
        variantKey: "ST03-R_ST03-001R★★",
        variantBadge: "2★ 典藏",
        variantStar: 2
      },
      {
        cardId: "c-st03-001_ST03-R_ST03-001R★",
        cardNumber: "ST03-001",
        name: "薇拉·瑰丽",
        count: 3,
        imageUrl: "/cards/ST03-R_ST03-001R★.png",
        variantKey: "ST03-R_ST03-001R★",
        variantBadge: "1★ 闪卡",
        variantStar: 1
      },
      {
        cardId: "c-st03-002_ST03-R_ST03-002R★",
        cardNumber: "ST03-002",
        name: "薇拉·瑰丽",
        count: 4,
        imageUrl: "/cards/ST03-R_ST03-002R★.png",
        variantKey: "ST03-R_ST03-002R★",
        variantBadge: "1★ 闪卡",
        variantStar: 1
      },
      {
        cardId: "c-st03-003_ST03-ST_ST03-003ST",
        cardNumber: "ST03-003",
        name: "薇拉·瑰丽",
        count: 4,
        imageUrl: "/cards/ST03-ST_ST03-003ST.png",
        variantKey: "ST03-ST_ST03-003ST",
        variantBadge: "ST 原画",
        variantStar: 0
      },
      {
        cardId: "c-st03-004_ST03-ST_ST03-004ST",
        cardNumber: "ST03-004",
        name: "薇拉·瑰丽",
        count: 2,
        imageUrl: "/cards/ST03-ST_ST03-004ST.png",
        variantKey: "ST03-ST_ST03-004ST",
        variantBadge: "ST 原画",
        variantStar: 0
      },
      {
        cardId: "c-st03-005_ST03-ST_ST03-005ST",
        cardNumber: "ST03-005",
        name: "薇拉·瑰丽",
        count: 4,
        imageUrl: "/cards/ST03-ST_ST03-005ST.png",
        variantKey: "ST03-ST_ST03-005ST",
        variantBadge: "ST 原画",
        variantStar: 0
      },
      {
        cardId: "c-st03-006_ST03-ST_ST03-006ST",
        cardNumber: "ST03-006",
        name: "21号·XXI",
        count: 4,
        imageUrl: "/cards/ST03-ST_ST03-006ST.png",
        variantKey: "ST03-ST_ST03-006ST",
        variantBadge: "ST 原画",
        variantStar: 0
      },
      {
        cardId: "c-st03-007_ST03-ST_ST03-007ST",
        cardNumber: "ST03-007",
        name: "21号·XXI",
        count: 2,
        imageUrl: "/cards/ST03-ST_ST03-007ST.png",
        variantKey: "ST03-ST_ST03-007ST",
        variantBadge: "ST 原画",
        variantStar: 0
      },
      {
        cardId: "c-st03-008_ST03-R_ST03-008R★",
        cardNumber: "ST03-008",
        name: "21号·XXI",
        count: 4,
        imageUrl: "/cards/ST03-R_ST03-008R★.png",
        variantKey: "ST03-R_ST03-008R★",
        variantBadge: "1★ 闪卡",
        variantStar: 1
      },
      {
        cardId: "c-st03-009_ST03-ST_ST03-009ST",
        cardNumber: "ST03-009",
        name: "可靠的伙伴 21号&诺克提",
        count: 4,
        imageUrl: "/cards/ST03-ST_ST03-009ST.png",
        variantKey: "ST03-ST_ST03-009ST",
        variantBadge: "ST 原画",
        variantStar: 0
      },
      {
        cardId: "c-st03-010_ST03-ST_ST03-010ST",
        cardNumber: "ST03-010",
        name: "暗域力场",
        count: 2,
        imageUrl: "/cards/ST03-ST_ST03-010ST.png",
        variantKey: "ST03-ST_ST03-010ST",
        variantBadge: "ST 原画",
        variantStar: 0
      },
      {
        cardId: "c-st03-011_ST03-ST_ST03-011ST",
        cardNumber: "ST03-011",
        name: "三头犬出击",
        count: 4,
        imageUrl: "/cards/ST03-ST_ST03-011ST.png",
        variantKey: "ST03-ST_ST03-011ST",
        variantBadge: "ST 原画",
        variantStar: 0
      },
      {
        cardId: "c-st03-012_ST03-ST_ST03-012ST",
        cardNumber: "ST03-012",
        name: "猩红连斩",
        count: 4,
        imageUrl: "/cards/ST03-ST_ST03-012ST.png",
        variantKey: "ST03-ST_ST03-012ST",
        variantBadge: "ST 原画",
        variantStar: 0
      },
      {
        cardId: "c-st03-013_ST03-ST_ST03-013ST",
        cardNumber: "ST03-013",
        name: "侵蚀烙印",
        count: 4,
        imageUrl: "/cards/ST03-ST_ST03-013ST.png",
        variantKey: "ST03-ST_ST03-013ST",
        variantBadge: "ST 原画",
        variantStar: 0
      },
      {
        cardId: "c-st03-014_ST03-ST_ST03-014ST",
        cardNumber: "ST03-014",
        name: "赤影突击",
        count: 4,
        imageUrl: "/cards/ST03-ST_ST03-014ST.png",
        variantKey: "ST03-ST_ST03-014ST",
        variantBadge: "ST 原画",
        variantStar: 0
      }
    ],
    coverImage: "/cards/ST03-R_ST03-001R★★.png",
    createdAt: 1791110912960,
    isOfficial: true
  }
];

/** 官方预组的历史别名 (旧版客户端可能使用这些 ID 引用 ST01) */
const STARTER_DECK_ALIASES: Record<string, string> = {
  'default-starter-deck': 'deck-1791110685763',
  'deck-st01': 'deck-1791110685763',
};

export function findOfficialStarterDeck(id: string): StarterDeck | undefined {
  if (!id) return undefined;
  const canonicalId = STARTER_DECK_ALIASES[id] ?? id;
  return OFFICIAL_STARTER_DECKS.find((d) => d.id === canonicalId);
}
