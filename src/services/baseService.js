
/**
 * Helper: Get the base URL of the currently active or first found Salesforce tab.
 * This is used to construct full URLs for navigation.
 */
export async function getSalesforceBaseURL() {
    // Query for tabs that look like Salesforce Lightning
    const tabs = await chrome.tabs.query({ url: "*://*.lightning.force.com/*" });

    if (tabs.length > 0) {
        const url = new URL(tabs[0].url);
        return url.origin; // e.g., https://my-domain.lightning.force.com
    }

    // Fallback: Check if we are triggered from a Salesforce tab directly
    const [activeTab] = await chrome.tabs.query({ active: true, currentWindow: true });
    if (activeTab && activeTab.url.includes("lightning.force.com")) {
        const url = new URL(activeTab.url);
        return url.origin;
    }

    throw new Error("Could not find an open Salesforce tab to determine the base URL. Please login to Salesforce in another tab.");
}

/**
 * Injects the scraping script into the given tab and retrieves the data.
 * @param {number} tabId - The ID of the tab to scrape.
 * @param {string} objectType - 'Leads', 'Contacts', etc. (Only used for logging/context if needed)
 */
export async function extractFromPage(tabId, objectType) {
    // Execute the scraper function in the context of the page
    const result = await chrome.scripting.executeScript({
        target: { tabId },
        func: extractSalesforceRecordsInPage,
        args: [{
            waitMs: 500,        // Slightly slower to be safe
            maxScrolls: 200,    // Allow deep scrolling
            stablePasses: 6     // Wait for stability
        }]
    });

    // result[0].result contains the return value of extractSalesforceRecordsInPage
    const data = result[0]?.result;

    if (!data || !data.records) {
        throw new Error("Script execution failed or returned no data.");
    }

    return data.records;
}

/**
 * The scraping algorithm provided by the user.
 * This function is serialized and injected into the page, so it must be self-contained.
 */
async function extractSalesforceRecordsInPage(options = {}) {
    const {
        tableSelector = 'table[role="grid"].uiVirtualDataTable',
        scrollContainerSelector = '.uiScroller.scroller-wrapper.scroll-bidirectional.native',
        waitMs = 300,
        maxScrolls = 200,
        stablePasses = 6
    } = options;

    console.log("🚀 Salesforce Scraper Started via Extension");

    const table = document.querySelector(tableSelector);
    if (!table) {
        console.warn("Table not found with selector:", tableSelector);
        return { finalRecord: null, records: [] };
    }

    const scrollContainer = (() => {
        const direct = document.querySelector(scrollContainerSelector);
        if (direct) return direct;

        const candidates = Array.from(document.querySelectorAll('.uiScroller.scroller-wrapper'));
        const active = candidates.find(el => el.scrollHeight > el.clientHeight);
        if (active) return active;

        let el = table.parentElement;
        while (el) {
            const style = getComputedStyle(el);
            const overflowY = style.overflowY;
            if ((overflowY === 'auto' || overflowY === 'scroll') && el.scrollHeight > el.clientHeight) {
                return el;
            }
            el = el.parentElement;
        }

        return document.scrollingElement || document.documentElement;
    })();

    const headerLabels = Array.from(table.querySelectorAll('thead th')).map(th => {
        const label =
            th.getAttribute('aria-label') ||
            th.getAttribute('title') ||
            th.textContent ||
            '';
        return label.trim();
    });

    const isDataHeader = (label) => {
        if (!label) return false;
        const l = label.toLowerCase();
        if (l.includes('select')) return false;
        if (l === 'action') return false;
        if (l === 'item number') return false;
        return true;
    };

    const cleanText = (text) => text.replace(/\s+/g, ' ').trim();

    const extractCellValue = (cell) => {
        if (!cell) return '';

        const link = cell.querySelector('a.outputLookupLink');
        if (link) return cleanText(link.textContent);

        const date = cell.querySelector('.uiOutputDate');
        if (date) return cleanText(date.textContent);

        const amount = cell.querySelector('.sfaOpportunityDealMotionAmount');
        if (amount) return cleanText(amount.textContent);

        const truncate = cell.querySelector('.slds-truncate');
        if (truncate) return cleanText(truncate.textContent);

        const clone = cell.cloneNode(true);
        clone.querySelectorAll(
            '.slds-assistive-text, .assistiveText, button, svg, use, input, .triggerContainer, .slds-button, .slds-icon_container, .forceVirtualAction, .checkbox-container'
        ).forEach(n => n.remove());

        return cleanText(clone.textContent);
    };

    const rowToObject = (row) => {
        const cells = Array.from(row.querySelectorAll('th, td'));
        const record = {};

        cells.forEach((cell, i) => {
            const label = headerLabels[i] || '';
            if (!isDataHeader(label)) return;
            record[label] = extractCellValue(cell);
        });

        const recordIdLink = row.querySelector('a[data-recordid]');
        if (recordIdLink) {
            record.Id = recordIdLink.getAttribute('data-recordid');
            record.Url = recordIdLink.getAttribute('href');
        }

        return record;
    };

    const getRowKey = (row) => {
        const link = row.querySelector('a[data-recordid]');
        if (link) return link.getAttribute('data-recordid');
        return cleanText(row.textContent).slice(0, 200);
    };

    const recordMap = new Map();
    const order = [];

    let stable = 0;
    let lastScrollTop = -1;

    for (let i = 0; i < maxScrolls; i++) {
        const rows = Array.from(table.querySelectorAll('tbody tr'));
        let newFound = 0;

        rows.forEach(row => {
            const key = getRowKey(row);
            const record = rowToObject(row);

            if (!recordMap.has(key)) {
                recordMap.set(key, record);
                order.push(key);
                newFound++;
            } else {
                recordMap.set(key, { ...recordMap.get(key), ...record });
            }
        });

        scrollContainer.scrollTop = scrollContainer.scrollTop + scrollContainer.clientHeight;

        // We must await inside the injected function too
        await new Promise(r => setTimeout(r, waitMs));

        const noMove = scrollContainer.scrollTop === lastScrollTop;
        const noNew = newFound === 0;

        if (noMove && noNew) {
            stable++;
            if (stable >= stablePasses) break;
        } else {
            stable = 0;
        }

        lastScrollTop = scrollContainer.scrollTop;
    }

    // One final check at the bottom
    scrollContainer.scrollTop = scrollContainer.scrollHeight;
    await new Promise(r => setTimeout(r, waitMs));

    const records = order.map(k => recordMap.get(k)).filter(Boolean);
    const finalRecord = records.length ? records[records.length - 1] : null;

    return { finalRecord, records };
}
