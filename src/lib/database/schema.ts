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
        cover_url: {
            type: 'string'
        },
        file_hash: {
            type: 'string'
        },
        updated_at: {
            type: 'number'
        },
        is_deleted: {
            type: 'boolean'
        }
    },
    required: ['id', 'title', 'updated_at']
} as const;

const schemaTyped = toTypedRxJsonSchema(bookSchemaLiteral);
export type RxBookDocumentType = ExtractDocumentTypeFromTypedRxJsonSchema<typeof schemaTyped>;

export const bookSchema: RxJsonSchema<RxBookDocumentType> = bookSchemaLiteral;

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
        updated_at: {
            type: 'number'
        }
    },
    required: ['user_id', 'updated_at']
} as const;

const settingsSchemaTyped = toTypedRxJsonSchema(settingsSchemaLiteral);
export type RxSettingsDocumentType = ExtractDocumentTypeFromTypedRxJsonSchema<typeof settingsSchemaTyped>;

export const settingsSchema: RxJsonSchema<RxSettingsDocumentType> = settingsSchemaLiteral;
