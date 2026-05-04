/**
 * Phone Mask Utility
 * Formats phone numbers as (XX) XXXXX-XXXX or (XX) XXXX-XXXX
 */

export function attachPhoneMask(inputElement) {
    if (!inputElement) return;

    function formatPhone(value) {
        // Remove non-digits
        const numbers = value.replace(/\D/g, '');

        // Limit to 11 digits
        const truncated = numbers.substring(0, 11);

        // Apply formatting
        if (truncated.length > 10) {
            // (11) 91234-5678
            return truncated.replace(/(\d{2})(\d{5})(\d{4})/, '($1) $2-$3');
        } else if (truncated.length > 5) {
            // (11) 1234-5678
            return truncated.replace(/(\d{2})(\d{4})(\d{0,4})/, '($1) $2-$3');
        } else if (truncated.length > 2) {
            // (11) 123...
            return truncated.replace(/(\d{2})(\d{0,5})/, '($1) $2');
        } else if (truncated.length > 0) {
            // (1...
            return truncated.replace(/(\d{0,2})/, '($1');
        }
        return truncated;
    }

    inputElement.addEventListener('input', (e) => {
        const cursorPosition = e.target.selectionStart;
        const oldLength = e.target.value.length;

        e.target.value = formatPhone(e.target.value);

        // Adjust cursor position if formatting changed length (basic approximation)
        // Ideally we'd track digit count before/after cursor, but for simple mask end-of-input is often fine or native behavior holds.
    });
}
