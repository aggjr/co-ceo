/**
 * Currency Mask Utility
 * Implements "shift-left" input behavior for Brazilian Real (BRL).
 * 
 * Behavior:
 * - Strips all non-digit characters.
 * - Treats the number as cents (divides by 100).
 * - Formats as pt-BR currency (e.g. 1 -> 0,01).
 */

export const formatCurrency = (value) => {
    // 1. Get digits
    const digits = String(value).replace(/\D/g, '');

    // 2. Handle empty
    if (!digits) return '';

    // 3. Parse cents
    const cents = parseInt(digits, 10);

    // 4. Convert to float
    const floatVal = cents / 100;

    // 5. Format
    return floatVal.toLocaleString('pt-BR', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
};

export const parseCurrency = (str) => {
    if (!str) return 0;
    // Remove "R$", trim, remove dots (thousands), replace comma with dot
    // But since our mask output is "1.000,00", we can just:
    const clean = String(str).replace(/\./g, '').replace(',', '.');
    // Remove any other non-numeric chars except dot
    const numStr = clean.replace(/[^0-9.]/g, '');
    return parseFloat(numStr) || 0;
};

// Use this to render initial values from float
export const formatFloatToCurrency = (num) => {
    if (num === undefined || num === null) return '';
    return Number(num).toLocaleString('pt-BR', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
};

export const attachCurrencyMask = (inputElement, onValidate = null) => {
    if (!inputElement) return;

    const handleInput = (e) => {
        const val = e.target.value;
        const formatted = formatCurrency(val);

        if (val !== formatted) {
            e.target.value = formatted;
        }

        if (onValidate) onValidate();
    };

    const handleFocus = (e) => {
        // Move cursor to end to facilitate appending digits
        setTimeout(() => {
            e.target.selectionStart = e.target.selectionEnd = e.target.value.length;
        }, 0);
    };

    const handleBlur = (e) => {
        // Ensure format and validate
        // Optional: if empty or zero, maybe clear? 
        // Current requirement: just ensure mask.
        e.target.value = formatCurrency(e.target.value);
        if (onValidate) onValidate();
    };

    inputElement.addEventListener('input', handleInput);
    inputElement.addEventListener('focus', handleFocus);
    inputElement.addEventListener('blur', handleBlur);

    // Initial check (if value exists but is raw string)
    if (inputElement.value) {
        // If it's a raw number string like "1000.50", this might behave oddly if we don't handle it.
        // But usually inputs are initialized with formatFloatToCurrency.
        // If we want to be safe, we could assume if it has dot and no comma, it's float?
        // For now rely on consumer to initialize correctly.
    }
};
