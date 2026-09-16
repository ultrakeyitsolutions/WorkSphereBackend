import { NOTIFICATION_TYPES, NotificationType } from './notification.types';

// ─── Safe Template Engine ──────────────────────────────────────────────────
// Pure string substitution for {{variableName}}.
// Strictly avoids eval() or Function() constructor for zero security vulnerabilities.

export class TemplateEngine {
    /**
     * Replaces {{key}} in the template string with values from the variables dictionary.
     * Missing or undefined keys are replaced with an empty string or key name gracefully.
     */
    public static render(template: string, variables: Record<string, any> = {}): string {
        if (!template) return '';

        return template.replace(/\{\{\s*([a-zA-Z0-9_\.]+)\s*\}\}/g, (_, key) => {
            const val = this.getNestedValue(variables, key);
            if (val === undefined || val === null) {
                return '';
            }
            return String(val);
        });
    }

    /**
     * Formats notification title and message for a given type using preference custom templates
     * or default fallback templates from NOTIFICATION_TYPES registry.
     */
    public static formatNotification(
        type: NotificationType,
        customTitleTemplate?: string,
        customMessageTemplate?: string,
        context: Record<string, any> = {}
    ): { title: string; message: string } {
        const typeDef = NOTIFICATION_TYPES[type];

        const titleTemplate = customTitleTemplate || typeDef?.defaultTitle || 'Notification';
        const messageTemplate = customMessageTemplate || typeDef?.defaultMessage || '';

        const title = this.render(titleTemplate, context);
        const message = this.render(messageTemplate, context);

        return { title, message };
    }

    /**
     * Safely drills down into nested objects like metadata.taskTitle if needed
     */
    private static getNestedValue(obj: Record<string, any>, path: string): any {
        return path.split('.').reduce((acc, part) => {
            if (acc && typeof acc === 'object') {
                return acc[part];
            }
            return undefined;
        }, obj);
    }
}
