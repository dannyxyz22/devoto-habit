import {
    toTypedRxJsonSchema,
    ExtractDocumentTypeFromTypedRxJsonSchema,
    RxJsonSchema
} from 'rxdb';

export const bookSchemaLiteral = {
    version: 0,
    primaryKey: 'id',
    type: 'object',
    properties: {
        id: {
            type: 'string',
            maxLength: 100
        },
        user_id: {
            type: 'string'
        },
        title: {
            type: 'string'
        },
        author: {
            type: 'string'
        },
        type: {
            type: 'string',
            enum: ['physical', 'epub']
        },
        total_pages: {
            type: 'number',
            minimum: 0
        },
        current_page: {
            type: 'number',
            minimum: 0
        },
        percentage: {
            type: 'number',
            minimum: 0,
            maximum: 100
        },
        part_index: {
            type: 'number',
            minimum: 0
        },
        chapter_index: {
            type: 'number',
            minimum: 0
        },
        last_location_cfi: {
            type: 'string'
        },
        cover_url: {
            type: 'string'
        },
        file_hash: {
            type: 'string'
        },
        added_date: {
            type: 'number'
        },
        published_date: {
            type: 'string'
        },
        progress_version: {
            type: "number",
            minimum: 0
        },
        _modified: {
            type: 'number'
        },
        _deleted: {
            type: 'boolean'
        }
    },
    required: ['id', 'title', '_modified', 'progress_version']
} as const;

const schemaTyped = toTypedRxJsonSchema(bookSchemaLiteral);
export type RxBookDocumentType = ExtractDocumentTypeFromTypedRxJsonSchema<typeof schemaTyped>;

export const bookSchema: RxJsonSchema<RxBookDocumentType> = bookSchemaLiteral;

export const userEpubSchemaLiteral = {
    version: 0,
    primaryKey: 'id',
    type: 'object',
    properties: {
        id: {
            type: 'string',
            maxLength: 100
        },
        user_id: {
            type: 'string'
        },
        title: {
            type: 'string'
        },
        author: {
            type: 'string'
        },
        file_hash: {
            type: 'string'
        },
        file_size: {
            type: 'number'
        },
        cover_url: {
            type: 'string'
        },
        percentage: {
            type: 'number',
            minimum: 0,
            maximum: 100
        },
        last_location_cfi: {
            type: 'string'
        },
        added_date: {
            type: 'number'
        },
        _modified: {
            type: 'number'
        },
        _deleted: {
            type: 'boolean'
        }
    },
    required: ['id', 'title', 'file_hash', 'added_date', '_modified']
} as const;

const userEpubSchemaTyped = toTypedRxJsonSchema(userEpubSchemaLiteral);
export type RxUserEpubDocumentType = ExtractDocumentTypeFromTypedRxJsonSchema<typeof userEpubSchemaTyped>;

export const userEpubSchema: RxJsonSchema<RxUserEpubDocumentType> = userEpubSchemaLiteral;

export const settingsSchemaLiteral = {
    version: 0,
    primaryKey: 'user_id',
    type: 'object',
    properties: {
        user_id: {
            type: 'string',
            maxLength: 100
        },
        theme: {
            type: 'string'
        },
        font_size: {
            type: 'number'
        },
        text_align: {
            type: 'string'
        },
        line_spacing: {
            type: 'string'
        },
        last_active_book_id: {
            type: 'string'
        },
        daily_goal_minutes: {
            type: 'number'
        },
        _modified: {
            type: 'number'
        }
    },
    required: ['user_id', '_modified']
} as const;

const settingsSchemaTyped = toTypedRxJsonSchema(settingsSchemaLiteral);
export type RxSettingsDocumentType = ExtractDocumentTypeFromTypedRxJsonSchema<typeof settingsSchemaTyped>;

export const settingsSchema: RxJsonSchema<RxSettingsDocumentType> = settingsSchemaLiteral;

// Reading Plans Schema
export const readingPlanSchemaLiteral = {
    version: 0,
    primaryKey: 'id',
    type: 'object',
    properties: {
        id: {
            type: 'string',
            maxLength: 100
        },
        user_id: {
            type: 'string'
        },
        book_id: {
            type: 'string',
            maxLength: 100
        },
        target_date_iso: {
            type: 'string'
        },
        target_part_index: {
            type: 'number'
        },
        target_chapter_index: {
            type: 'number'
        },
        start_part_index: {
            type: 'number'
        },
        start_chapter_index: {
            type: 'number'
        },
        start_words: {
            type: 'number'
        },
        start_percent: {
            type: 'number'
        },
        _modified: {
            type: 'number'
        },
        _deleted: {
            type: 'boolean'
        }
    },
    required: ['id', 'book_id', '_modified']
} as const;

const readingPlanSchemaTyped = toTypedRxJsonSchema(readingPlanSchemaLiteral);
export type RxReadingPlanDocumentType = ExtractDocumentTypeFromTypedRxJsonSchema<typeof readingPlanSchemaTyped>;

export const readingPlanSchema: RxJsonSchema<RxReadingPlanDocumentType> = readingPlanSchemaLiteral;

// Daily Baselines Schema
export const dailyBaselineSchemaLiteral = {
    version: 0,
    primaryKey: 'id',
    type: 'object',
    properties: {
        id: {
            type: 'string',
            maxLength: 150
        },
        user_id: {
            type: 'string'
        },
        book_id: {
            type: 'string',
            maxLength: 100
        },
        date_iso: {
            type: 'string',
            maxLength: 10
        },
        words: {
            type: 'number'
        },
        percent: {
            type: 'number'
        },
        _modified: {
            type: 'number'
        },
        _deleted: {
            type: 'boolean'
        }
    },
    required: ['id', 'book_id', 'date_iso', '_modified']
} as const;

const dailyBaselineSchemaTyped = toTypedRxJsonSchema(dailyBaselineSchemaLiteral);
export type RxDailyBaselineDocumentType = ExtractDocumentTypeFromTypedRxJsonSchema<typeof dailyBaselineSchemaTyped>;

export const dailyBaselineSchema: RxJsonSchema<RxDailyBaselineDocumentType> = dailyBaselineSchemaLiteral;

// User Stats Schema
export const userStatsSchemaLiteral = {
    version: 0,
    primaryKey: 'id',
    type: 'object',
    properties: {
        id: {
            type: 'string',
            maxLength: 100
        },
        user_id: {
            type: 'string',
            maxLength: 100
        },
        streak_current: {
            type: 'number'
        },
        streak_longest: {
            type: 'number'
        },
        last_read_iso: {
            type: 'string'
        },
        freeze_available: {
            type: 'boolean'
        },
        total_minutes: {
            type: 'number'
        },
        last_book_id: {
            type: 'string'
        },
        minutes_by_date: {
            type: 'string'
        },
        _modified: {
            type: 'number'
        },
        _deleted: {
            type: 'boolean'
        }
    },
    required: ['id', 'user_id', '_modified']
} as const;

const userStatsSchemaTyped = toTypedRxJsonSchema(userStatsSchemaLiteral);
export type RxUserStatsDocumentType = ExtractDocumentTypeFromTypedRxJsonSchema<typeof userStatsSchemaTyped>;

export const userStatsSchema: RxJsonSchema<RxUserStatsDocumentType> = userStatsSchemaLiteral;
