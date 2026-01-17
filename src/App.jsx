import { useState, useMemo, useEffect } from 'react'
import './index.css'
import { getSalesforceBaseURL, extractFromPage } from './services/baseService';

const OBJECTS = ['Leads', 'Contacts', 'Accounts', 'Opportunities', 'Tasks', 'Related']

function App() {
    const [activeTab, setActiveTab] = useState('Opportunities')
    const [recordsByType, setRecordsByType] = useState({})
    const [loading, setLoading] = useState(false)
    const [progress, setProgress] = useState(null)
    const [lastUpdated, setLastUpdated] = useState(null)
    const [error, setError] = useState(null)
    const [extractionStatus, setExtractionStatus] = useState({})
    const [autoSave, setAutoSave] = useState(true)
    const [showExportDropdown, setShowExportDropdown] = useState(false)

    const STORAGE_KEY = 'salesforce_data'

    const isIdField = (key) => {
        const k = key.toLowerCase();
        // Ignore fields that are strictly IDs, URLs, or internal sync metadata
        return k === 'id' ||
            k === 'url' ||
            k === 'foundin' ||
            k === 'lastsync' ||
            k.endsWith('id') ||
            k.includes(' id ');
    };

    // Memoized related data (items found in multiple categories)
    const relatedData = useMemo(() => {
        const valueMap = new Map(); // value.toLowerCase() -> Set of categories

        const categories = ['Leads', 'Contacts', 'Accounts', 'Opportunities', 'Tasks'];

        // 1. Index all values from all categories
        categories.forEach(type => {
            const records = recordsByType[type] || [];
            records.forEach(record => {
                Object.entries(record).forEach(([key, val]) => {
                    if (isIdField(key)) return;
                    if (!val || typeof val !== 'string') return;

                    const cleanVal = val.trim().toLowerCase();
                    if (cleanVal.length < 3) return; // Skip very short values

                    if (!valueMap.has(cleanVal)) {
                        valueMap.set(cleanVal, new Set());
                    }
                    valueMap.get(cleanVal).add(type);
                });
            });
        });

        // 2. Find records that contain a value appearing in more than one category
        const relatedResults = [];
        const seenRecords = new Set();

        categories.forEach(type => {
            const records = recordsByType[type] || [];
            records.forEach(record => {
                const recKey = record.Id || record.id || JSON.stringify(record);
                if (seenRecords.has(recKey)) return;

                const foundIn = new Set([type]);
                let hasCrossMatch = false;

                Object.entries(record).forEach(([key, val]) => {
                    if (isIdField(key)) return;
                    if (!val || typeof val !== 'string') return;

                    const cleanVal = val.trim().toLowerCase();
                    const matchedCats = valueMap.get(cleanVal);

                    if (matchedCats && matchedCats.size > 1) {
                        hasCrossMatch = true;
                        matchedCats.forEach(cat => foundIn.add(cat));
                    }
                });

                if (hasCrossMatch) {
                    relatedResults.push({
                        ...record,
                        foundIn: Array.from(foundIn).sort()
                    });
                    seenRecords.add(recKey);
                }
            });
        });

        return relatedResults;
    }, [recordsByType]);

    // Get current data based on active tab
    const currentData = activeTab === 'Related' ? relatedData : (recordsByType[activeTab] || []);

    // Dynamic columns based on extracted data (id hidden; name first)
    const columns = useMemo(() => {
        if (!currentData || currentData.length === 0) return [];

        const keys = [];
        currentData.forEach(rec => {
            Object.keys(rec).forEach(k => {
                if (k === 'id') return;
                if (!keys.includes(k)) keys.push(k);
            });
        });

        // Ensure name is first if present
        const nameIndex = keys.indexOf('name');
        if (nameIndex > 0) {
            keys.splice(nameIndex, 1);
            keys.unshift('name');
        }

        // Add 'foundIn' to the end for Related tab
        if (activeTab === 'Related') {
            keys.push('foundIn');
        }

        return keys;
    }, [currentData, activeTab]);

    const getStorage = () => {
        if (typeof chrome !== 'undefined' && chrome.storage && chrome.storage.local) {
            return chrome.storage.local;
        }
        // Fallback or Dev mode: use localStorage ( getting error on extension storage)
        console.warn('Using localStorage (Dev Mode)');
        return {
            get: async (key) => {
                // chrome.storage.local.get accepts string, array, or object. We handle string/array of 1.
                const k = typeof key === 'object' && !Array.isArray(key) ? Object.keys(key)[0] :
                    Array.isArray(key) ? key[0] : key;
                const val = localStorage.getItem(k);
                return val ? { [k]: JSON.parse(val) } : {};
            },
            set: async (items) => {
                Object.entries(items).forEach(([k, v]) => localStorage.setItem(k, JSON.stringify(v)));
            }
        };
    };

    const persistToStorage = async (dataByType) => {
        try {
            const storage = getStorage();
            // Save AS IS (no mapping) to preserve all scraped fields
            const payload = {
                leads: dataByType['Leads'] || [],
                contacts: dataByType['Contacts'] || [],
                accounts: dataByType['Accounts'] || [],
                opportunities: dataByType['Opportunities'] || [],
                tasks: dataByType['Tasks'] || [],
                baseURL: dataByType['baseURL'] || '',
                lastSync: Date.now()
            };
            await storage.set({ [STORAGE_KEY]: payload });
            console.log('✅ Data saved to storage');
        } catch (e) {
            console.error('Failed to persist data to extension storage', e);
            setError('Failed to save data: ' + e.message);
        }
    };

    useEffect(() => {
        const loadFromStorage = async () => {
            try {
                const storage = getStorage();
                const stored = await storage.get(STORAGE_KEY);
                const payload = stored?.[STORAGE_KEY]?.salesforce_data || stored?.[STORAGE_KEY];
                if (!payload) return;

                setRecordsByType({
                    Leads: payload.leads || [],
                    Contacts: payload.contacts || [],
                    Accounts: payload.accounts || [],
                    Opportunities: payload.opportunities || [],
                    Tasks: payload.tasks || [],
                    baseURL: payload.baseURL || ''
                });

                if (payload.lastSync) {
                    setLastUpdated(new Date(payload.lastSync).toLocaleTimeString());
                }
                console.log('✅ Data loaded from storage');

                // If baseURL is missing from storage, try to detect it now
                if (!payload.baseURL) {
                    try {
                        const detectedURL = await getSalesforceBaseURL();
                        setRecordsByType(prev => ({ ...prev, baseURL: detectedURL }));
                    } catch (e) {
                        console.log('Could not auto-detect Salesforce URL on mount');
                    }
                }
            } catch (e) {
                console.error('Failed to load saved data:', e);
            }
        };

        loadFromStorage();
    }, []);

    const handleManualSave = async () => {
        await persistToStorage(recordsByType);
        setLastUpdated(new Date().toLocaleTimeString());
    };

    // Handler: Extract ALL data from all CRM objects
    const handleExtractData = async () => {
        console.log('🚀 Extract All Data button clicked');
        setLoading(true);
        setError(null);
        setProgress(null);
        setExtractionStatus({});

        const objectURLs = {
            'Leads': '/lightning/o/Lead/list?filterName=AllOpenLeads',
            'Contacts': '/lightning/o/Contact/list?filterName=allContacts',
            'Accounts': '/lightning/o/Account/list?filterName=AllAccounts',
            'Opportunities': '/lightning/o/Opportunity/list?filterName=allOpportunities',
            'Tasks': '/lightning/o/Task/list'
        };

        const results = {};

        try {
            // Validate we're on Salesforce
            const baseURL = await getSalesforceBaseURL();

            // Extract all objects sequentially with progress updates
            for (const [objectType, path] of Object.entries(objectURLs)) {
                setExtractionStatus(prev => ({
                    ...prev,
                    [objectType]: 'extracting'
                }));

                setProgress({
                    currentObject: objectType,
                    completed: Object.keys(results).length,
                    total: OBJECTS.length
                });

                try {
                    console.log(`📞 Extracting ${objectType}...`);

                    // Open tab for this object type
                    const tab = await chrome.tabs.create({
                        url: baseURL + path,
                        active: false
                    });

                    // Wait for page to load
                    await new Promise(resolve => {
                        chrome.tabs.onUpdated.addListener(function listener(tabId, info) {
                            if (tabId === tab.id && info.status === 'complete') {
                                chrome.tabs.onUpdated.removeListener(listener);
                                setTimeout(resolve, 4000);
                            }
                        });
                    });

                    // Extract data
                    const data = await extractFromPage(tab.id, objectType);

                    // Close the tab
                    await chrome.tabs.remove(tab.id);

                    results[objectType] = data || [];
                    setExtractionStatus(prev => ({
                        ...prev,
                        [objectType]: 'success'
                    }));

                    // Update UI immediately after each object is extracted
                    setRecordsByType(prev => ({
                        ...prev,
                        [objectType]: data || []
                    }));

                } catch (err) {
                    console.error(`❌ Error extracting ${objectType}:`, err);
                    setExtractionStatus(prev => ({
                        ...prev,
                        [objectType]: 'error'
                    }));
                    results[objectType] = [];

                    // Show error message to user
                    if (err.message && err.message.includes('Salesforce page')) {
                        setError(err.message);
                        setLoading(false);
                        setProgress(null);
                        return;
                    }
                }
            }

            const combined = { ...recordsByType, ...results, baseURL };
            setRecordsByType(combined);

            if (autoSave) {
                await persistToStorage(combined);
            }

            setLastUpdated(new Date().toLocaleTimeString());
            console.log('✅ All extractions completed!');

        } catch (err) {
            console.error('❌ Extraction error:', err);
            setError(err.message || 'Failed to extract data');
        } finally {
            setLoading(false);
            setProgress(null);
        }
    };

    // Handler: Export to CSV
    const handleExportCSV = () => {
        if (currentData.length === 0) return;

        // Generate CSV from current data
        const headers = columns.join(',');
        const rows = currentData.map(record =>
            columns.map(col => {
                const value = record[col] || '';
                // Escape values containing commas or quotes
                if (value.includes(',') || value.includes('"')) {
                    return `"${value.replace(/"/g, '""')}"`;
                }
                return value;
            }).join(',')
        );

        const csv = [headers, ...rows].join('\n');
        const blob = new Blob([csv], { type: 'text/csv' });
        const url = URL.createObjectURL(blob);
        const a = document.createElement('a');
        a.href = url;
        a.download = `salesforce-${activeTab.toLowerCase()}-${new Date().toISOString().split('T')[0]}.csv`;
        document.body.appendChild(a);
        a.click();
        document.body.removeChild(a);
        URL.revokeObjectURL(url);
        setShowExportDropdown(false);
    };

    // Handler: Export to JSON (Entire Object)
    const handleExportJSON = () => {
        if (Object.keys(recordsByType).length === 0) return;

        const data = JSON.stringify(recordsByType, null, 2);
        const blob = new Blob([data], { type: 'application/json' });
        const url = URL.createObjectURL(blob);
        const a = document.createElement('a');
        a.href = url;
        a.download = `salesforce-all-data-${new Date().toISOString().split('T')[0]}.json`;
        document.body.appendChild(a);
        a.click();
        document.body.removeChild(a);
        URL.revokeObjectURL(url);
        setShowExportDropdown(false);
    };

    // Handler: Clear all data
    const handleClearAll = () => {
        if (confirm('Are you sure you want to clear all extracted data?')) {
            setRecordsByType({});
            setLastUpdated(null);
            setError(null);
        }
    };

    return (
        <div className="w-full h-full bg-gray-50 flex flex-col">
            {/* Header */}
            <header className="bg-gradient-to-r from-blue-600 to-blue-700 text-white p-4 shadow-lg">
                <div className="flex items-center justify-between gap-4 flex-wrap">
                    <div>
                        <h1 className="text-2xl font-bold">Shubham's Extractor</h1>
                        <p className="text-sm text-blue-100">Your Salesforce Companion</p>
                    </div>
                    <div className="flex items-center gap-3 flex-wrap">
                        <label className="flex items-center gap-2 text-sm text-blue-50">
                            <input
                                type="checkbox"
                                className="h-4 w-4"
                                checked={autoSave}
                                onChange={(e) => setAutoSave(e.target.checked)}
                            />
                            Auto-save
                        </label>
                        <button
                            onClick={handleManualSave}
                            disabled={Object.keys(recordsByType).length === 0}
                            className="px-4 py-2 text-sm border border-green-200 text-green-50 font-semibold rounded-lg bg-white/10 hover:bg-white/20 transition disabled:opacity-50 disabled:cursor-not-allowed"
                        >
                            Save
                        </button>
                        <button
                            onClick={handleExtractData}
                            disabled={loading}
                            className="px-6 py-2 bg-white text-blue-600 font-semibold rounded-lg hover:bg-blue-50 transition disabled:opacity-50 disabled:cursor-not-allowed"
                        >
                            {loading ? 'Extracting...' : 'Extract Data'}
                        </button>
                    </div>
                </div>
            </header>

            {/* Tabs - Now Scrollable */}
            <div className="bg-white border-b border-gray-200">
                <div className="flex overflow-x-auto whitespace-nowrap scrollbar-hide no-scrollbar">
                    {OBJECTS.map(obj => (
                        <button
                            key={obj}
                            onClick={() => setActiveTab(obj)}
                            className={`px-5 py-3 font-medium transition flex-shrink-0 flex items-center gap-2 ${activeTab === obj
                                ? 'text-blue-600 border-b-2 border-blue-600 bg-blue-50'
                                : 'text-gray-600 hover:text-gray-900'
                                }`}
                        >
                            {obj}
                            {obj === 'Related' && relatedData.length > 0 && (
                                <span className="flex h-4 w-4 items-center justify-center rounded-full bg-red-500 text-[9px] text-white animate-pulse">
                                    {relatedData.length}
                                </span>
                            )}
                        </button>
                    ))}
                </div>
            </div>

            {/* Stats */}
            <div className="bg-white border-b border-gray-200 px-6 py-3 flex justify-between items-center">
                <div className="flex gap-6">
                    <div><span className="text-gray-600">Total: </span><span className="font-bold">{currentData.length}</span></div>
                    <div><span className="text-gray-600">Updated: </span><span className="font-bold">{lastUpdated || 'Never'}</span></div>
                </div>
                <div className="flex gap-3 items-center">
                    <div className="relative">
                        <button
                            onClick={() => setShowExportDropdown(!showExportDropdown)}
                            disabled={!Object.values(recordsByType).some(arr => arr && arr.length > 0)}
                            className="px-4 py-1.5 text-sm border border-blue-600 text-blue-600 rounded hover:bg-blue-50 transition disabled:opacity-50 disabled:cursor-not-allowed flex items-center gap-2"
                        >
                            Export
                            <svg className={`w-4 h-4 transition-transform ${showExportDropdown ? 'rotate-180' : ''}`} fill="none" stroke="currentColor" viewBox="0 0 24 24">
                                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M19 9l-7 7-7-7" />
                            </svg>
                        </button>

                        {showExportDropdown && (
                            <div className="absolute right-0 mt-2 w-48 bg-white border border-gray-200 rounded-lg shadow-xl z-50 py-1 animate-in fade-in slide-in-from-top-2 duration-200">
                                <button
                                    onClick={handleExportCSV}
                                    className="w-full text-left px-4 py-2 text-sm text-gray-700 hover:bg-blue-50 hover:text-blue-600 transition flex items-center gap-2"
                                >
                                    <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M9 17v-2m3 2v-4m3 4v-6m2 10H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2z" />
                                    </svg>
                                    Export current (CSV)
                                </button>
                                <button
                                    onClick={handleExportJSON}
                                    className="w-full text-left px-4 py-2 text-sm text-gray-700 hover:bg-blue-50 hover:text-blue-600 transition flex items-center gap-2"
                                >
                                    <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M10 20l4-16m4 4l4 4-4 4M6 16l-4-4 4-4" />
                                    </svg>
                                    Export all (JSON)
                                </button>
                            </div>
                        )}
                    </div>
                    <button
                        onClick={handleClearAll}
                        disabled={currentData.length === 0}
                        className="px-4 py-1.5 text-sm border border-red-600 text-red-600 rounded hover:bg-red-50 transition disabled:opacity-50 disabled:cursor-not-allowed"
                    >
                        Clear All
                    </button>
                </div>
            </div>

            {/* Content */}
            <main className="flex-1 overflow-auto p-4">
                {loading && progress && (
                    <div className="bg-blue-50 border border-blue-200 rounded-lg p-4 mb-4">
                        <div className="flex items-center justify-between mb-3">
                            <div>
                                <p className="font-semibold text-blue-900">Extracting All Data...</p>
                                <p className="text-sm text-blue-700">Currently processing: {progress.currentObject}</p>
                                <p className="text-xs text-blue-600 mt-1">Progress: {progress.completed} of {progress.total} completed</p>
                            </div>
                            <div className="animate-spin rounded-full h-6 w-6 border-b-2 border-blue-600"></div>
                        </div>

                        {/* Progress for each object type */}
                        <div className="grid grid-cols-5 gap-2 mt-3">
                            {OBJECTS.map(obj => (
                                <div
                                    key={obj}
                                    className={`text-center py-2 px-1 rounded text-xs font-medium ${extractionStatus[obj] === 'success' ? 'bg-green-100 text-green-700' :
                                        extractionStatus[obj] === 'extracting' ? 'bg-blue-100 text-blue-700 animate-pulse' :
                                            extractionStatus[obj] === 'error' ? 'bg-red-100 text-red-700' :
                                                'bg-gray-100 text-gray-500'
                                        }`}
                                >
                                    {obj}
                                    {extractionStatus[obj] === 'success' && ' ✓'}
                                    {extractionStatus[obj] === 'extracting' && ' ⏳'}
                                    {extractionStatus[obj] === 'error' && ' ✗'}
                                </div>
                            ))}
                        </div>
                    </div>
                )}

                {error && (
                    <div className="bg-red-50 border border-red-200 rounded-lg p-4 mb-4">
                        <p className="font-semibold text-red-900">Error</p>
                        <p className="text-sm text-red-700">{error}</p>
                    </div>
                )}

                <div className="bg-white rounded-lg shadow border border-gray-200 h-full">
                    {currentData.length === 0 && !loading ? (
                        <div className="flex items-center justify-center h-full">
                            <div className="text-center text-gray-400">
                                <p className="text-lg font-semibold">No data extracted yet</p>
                                <p className="text-sm mt-1">Click "Extract Data" to start collecting {activeTab}</p>
                            </div>
                        </div>
                    ) : (
                        <div className="overflow-auto h-full p-4 space-y-6">
                            {currentData.map((record, index) => {
                                const recordKeys = Object.keys(record).filter(k => !isIdField(k));
                                // Move name-like fields to the top
                                recordKeys.sort((a, b) => {
                                    const aLow = a.toLowerCase();
                                    const bLow = b.toLowerCase();
                                    if (aLow.includes('name')) return -1;
                                    if (bLow.includes('name')) return 1;
                                    return 0;
                                });

                                return (
                                    <div key={record.Id || record.id || index} className="bg-white border-2 border-gray-200 rounded-xl overflow-hidden shadow-sm hover:shadow-md transition">
                                        <div className="bg-gray-50 px-4 py-2 border-b flex justify-between items-center">
                                            <span className="font-bold text-blue-700 uppercase text-xs tracking-wider">
                                                Record #{index + 1}
                                            </span>
                                            {record.foundIn && (
                                                <div className="flex gap-1">
                                                    {record.foundIn.map(type => (
                                                        <span key={type} className="px-2 py-0.5 bg-blue-100 text-blue-700 rounded-full text-[10px] font-black uppercase">
                                                            {type}
                                                        </span>
                                                    ))}
                                                </div>
                                            )}
                                        </div>
                                        <table className="w-full text-sm">
                                            <tbody>
                                                {recordKeys.map(key => (
                                                    <tr key={key} className="border-b last:border-0 hover:bg-gray-50/50 transition">
                                                        <td className="w-1/3 px-4 py-2 bg-gray-50/30 font-semibold text-gray-600 border-r">
                                                            {key}
                                                        </td>
                                                        <td className="px-4 py-2 text-gray-800 break-all">
                                                            {Array.isArray(record[key]) ? record[key].join(', ') : (record[key] || '-')}
                                                        </td>
                                                    </tr>
                                                ))}
                                                {record.Url && (
                                                    <tr className="border-t-2 border-gray-100">
                                                        <td className="px-4 py-2" colSpan="2">
                                                            {recordsByType.baseURL ? (
                                                                <a
                                                                    href={recordsByType.baseURL + record.Url}
                                                                    target="_blank"
                                                                    rel="noreferrer"
                                                                    className="text-blue-600 hover:underline text-xs flex items-center gap-1 font-medium"
                                                                >
                                                                    View in Salesforce
                                                                    <svg className="w-3 h-3" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                                                                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M10 6H6a2 2 0 00-2 2v10a2 2 0 002 2h10a2 2 0 002-2v-4M14 4h6m0 0v6m0-6L10 14" />
                                                                    </svg>
                                                                </a>
                                                            ) : (
                                                                <span className="text-gray-400 text-[10px] italic">
                                                                    Base URL not detected. Please open Salesforce to enable links.
                                                                </span>
                                                            )}
                                                        </td>
                                                    </tr>
                                                )}
                                            </tbody>
                                        </table>
                                    </div>
                                );
                            })}
                        </div>
                    )}
                </div>
            </main>

            {/* Footer */}
            <footer className="bg-white border-t border-gray-200 p-3">
                <div className="flex justify-center items-center gap-6">
                    <a
                        href="https://vshubham.com"
                        target="_blank"
                        rel="noreferrer"
                        className="text-xs font-semibold text-gray-500 hover:text-blue-600 transition flex items-center gap-1.5"
                    >
                        <svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M21 12a9 9 0 01-9 9m9-9a9 9 0 00-9-9m9 9H3m9 9a9 9 0 01-9-9m9 9c1.657 0 3-4.03 3-9s-1.343-9-3-9m0 18c-1.657 0-3-4.03-3-9s1.343-9 3-9m-9 9a9 9 0 019-9" />
                        </svg>
                        Portfolio
                    </a>
                    <a
                        href="https://linkedin.com/in/shubhamvs"
                        target="_blank"
                        rel="noreferrer"
                        className="text-xs font-semibold text-gray-500 hover:text-blue-700 transition flex items-center gap-1.5"
                    >
                        <svg className="w-3.5 h-3.5 fill-current" viewBox="0 0 24 24">
                            <path d="M19 0h-14c-2.761 0-5 2.239-5 5v14c0 2.761 2.239 5 5 5h14c2.762 0 5-2.239 5-5v-14c0-2.761-2.238-5-5-5zm-11 19h-3v-11h3v11zm-1.5-12.268c-.966 0-1.75-.79-1.75-1.764s.784-1.764 1.75-1.764 1.75.79 1.75 1.764-.783 1.764-1.75 1.764zm13.5 12.268h-3v-5.604c0-3.368-4-3.113-4 0v5.604h-3v-11h3v1.765c1.396-2.586 7-2.777 7 2.476v6.759z" />
                        </svg>
                        LinkedIn
                    </a>
                    <a
                        href="https://github.com/Shub3am"
                        target="_blank"
                        rel="noreferrer"
                        className="text-xs font-semibold text-gray-500 hover:text-gray-900 transition flex items-center gap-1.5"
                    >
                        <svg className="w-3.5 h-3.5 fill-current" viewBox="0 0 24 24">
                            <path d="M12 0c-6.626 0-12 5.373-12 12 0 5.302 3.438 9.8 8.207 11.387.599.111.793-.261.793-.577v-2.234c-3.338.726-4.033-1.416-4.033-1.416-.546-1.387-1.333-1.756-1.333-1.756-1.089-.745.083-.729.083-.729 1.205.084 1.839 1.237 1.839 1.237 1.07 1.834 2.807 1.304 3.492.997.107-.775.418-1.305.762-1.604-2.665-.305-5.467-1.334-5.467-5.931 0-1.311.469-2.381 1.236-3.221-.124-.303-.535-1.524.117-3.176 0 0 1.008-.322 3.301 1.23.957-.266 1.983-.399 3.003-.404 1.02.005 2.047.138 3.006.404 2.291-1.552 3.297-1.23 3.297-1.23.653 1.653.242 2.874.118 3.176.77.84 1.235 1.911 1.235 3.221 0 4.609-2.807 5.624-5.479 5.921.43.372.823 1.102.823 2.222v3.293c0 .319.192.694.801.576 4.765-1.589 8.199-6.086 8.199-11.386 0-6.627-5.373-12-12-12z" />
                        </svg>
                        GitHub
                    </a>
                </div>
            </footer>
        </div>
    )
}

export default App
