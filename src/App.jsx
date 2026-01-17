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

    // Memoized related data (items found in multiple categories)
    const relatedData = useMemo(() => {
        const matchMap = new Map();

        // Loop through all standard categories
        ['Leads', 'Contacts', 'Accounts', 'Opportunities', 'Tasks'].forEach(type => {
            const records = recordsByType[type] || [];
            records.forEach(record => {
                const key = record.Id || record.name;
                if (!key) return;

                if (!matchMap.has(key)) {
                    matchMap.set(key, { ...record, foundIn: [type] });
                } else {
                    const existing = matchMap.get(key);
                    if (!existing.foundIn.includes(type)) {
                        existing.foundIn.push(type);
                    }
                }
            });
        });

        return Array.from(matchMap.values()).filter(item => item.foundIn.length > 1);
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
                    Tasks: payload.tasks || []
                });

                if (payload.lastSync) {
                    setLastUpdated(new Date(payload.lastSync).toLocaleTimeString());
                }
                console.log('✅ Data loaded from storage');
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

            const combined = { ...recordsByType, ...results };
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
                        <h1 className="text-2xl font-bold">Salesforce Extractor</h1>
                        <p className="text-sm text-blue-100">Extract CRM data - Leads, Contacts, Accounts, Opportunities, Tasks</p>
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
                        <div className="overflow-auto h-full">
                            <table className="w-full text-sm">
                                <thead className="bg-gray-50 border-b sticky top-0">
                                    <tr>
                                        {columns.map(col => (
                                            <th key={col} className="px-4 py-2 text-left font-semibold text-gray-700">
                                                {col === 'name' ? 'Name' : col.replace(/field/i, 'Field ')}
                                            </th>
                                        ))}
                                    </tr>
                                </thead>
                                <tbody>
                                    {currentData.map((record, index) => (
                                        <tr key={record.Id || record.id || index} className={index % 2 === 0 ? 'bg-white' : 'bg-gray-50 hover:bg-blue-50/30 transition shadow-sm'}>
                                            {columns.map(col => (
                                                <td key={col} className={`px-4 py-2 border-b ${col === 'name' ? 'font-medium text-blue-900' : ''}`}>
                                                    {col === 'foundIn' ? (
                                                        <div className="flex gap-1 flex-wrap">
                                                            {record[col].map(type => (
                                                                <span key={type} className="px-2 py-0.5 bg-blue-100 text-blue-700 rounded-full text-[10px] uppercase font-bold tracking-wider">
                                                                    {type}
                                                                </span>
                                                            ))}
                                                        </div>
                                                    ) : (
                                                        record[col] || '-'
                                                    )}
                                                </td>
                                            ))}
                                        </tr>
                                    ))}
                                </tbody>
                            </table>
                        </div>
                    )}
                </div>
            </main>
        </div>
    )
}

export default App
