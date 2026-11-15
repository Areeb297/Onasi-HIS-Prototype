/**
 * The shared form system for data entry pages. Field, Input, Select and Textarea stay in ui/primitives (label above,
 * red asterisk, help text, error with a mark, unit inside the box). This folder adds the layout and behaviour.
 */
export { FormSection, FormGrid, ErrorSummary, FormActions, ReasonButton, AttentionLink, Stepper, focusField, useFormErrors, type Step } from "./FormLayout";
export { SegmentedControl, ChipMulti, ChipSingle, CheckRow, SearchSelect, ChoiceSelect, DateTimeInput, fitsSegmented, toOpts, SEARCH_FROM, type Opt } from "./FormControls";
export { useUnsavedChangesGuard, UnsavedChangesGuard } from "./UnsavedChangesGuard";
export { isDirty } from "./unsaved";
export { attentionText, isBlank, rules, validate, summaryItems, countIn, rangeText, type Errors } from "./validation";
export { saveDraft, loadDraft, clearDraft, draftTime, type Draft } from "./drafts";
