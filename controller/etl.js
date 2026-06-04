const axios = require('axios');
const { Client } = require('@microsoft/microsoft-graph-client');
const { TokenCredentialAuthenticationProvider } = require('@microsoft/microsoft-graph-client/authProviders/azureTokenCredentials');
const { ClientSecretCredential } = require('@azure/identity');

// dotenv already loaded by app.js
const isDev = process.env.NODE_ENV === 'development';

// STEP 0: Initialise Azure Graph client (runs once at module load)
if (!process.env.AZURE_TENANT_ID || !process.env.AZURE_CLIENT_ID || !process.env.AZURE_CLIENT_SECRET) {
    throw new Error('Missing required env vars for Microsoft Graph: AZURE_TENANT_ID, AZURE_CLIENT_ID, AZURE_CLIENT_SECRET');
}

//verify correct credentials are being used in dev logs without exposing secrets
// if (isDev) {
//     console.log('[ZohoETL] Initializing Microsoft Graph client with credentials:');
//     console.log('ZOHO_REFRESH_TOKEN:', process.env.ZOHO_REFRESH_TOKEN );
//     console.log('ZOHO_CLIENT_ID:', process.env.ZOHO_CLIENT_ID );
//     console.log('ZOHO_CLIENT_SECRET:', process.env.ZOHO_CLIENT_SECRET );
// }

const credential = new ClientSecretCredential(
    process.env.AZURE_TENANT_ID,
    process.env.AZURE_CLIENT_ID,
    process.env.AZURE_CLIENT_SECRET
);

const authProvider = new TokenCredentialAuthenticationProvider(credential, {
    scopes: ['https://graph.microsoft.com/.default']
});

const client = Client.initWithMiddleware({ authProvider });


// STEP 1: Get Zoho access token using refresh token
async function getZohoAccessToken() {
    if (!process.env.ZOHO_REFRESH_TOKEN) {
        throw new Error('ZOHO_REFRESH_TOKEN is not set in environment variables');
    }

    const response = await axios.post('https://accounts.zoho.in/oauth/v2/token', null, {
        params: {
            grant_type: 'refresh_token',
            client_id: process.env.ZOHO_CLIENT_ID,
            client_secret: process.env.ZOHO_CLIENT_SECRET,
            refresh_token: process.env.ZOHO_REFRESH_TOKEN
        }
    });

    if (isDev) {
        console.log('[ZohoETL] Zoho token response:', response.data);
    }

    const zohoAccessToken = response.data?.access_token;
    if (!zohoAccessToken) {
        const zohoError = response.data?.error || 'no access_token in response';
        throw new Error(`Zoho did not return an access token: ${zohoError}`);
    }

    return zohoAccessToken;
}


// STEP 2: Fetch workbooks and records from Zoho, filtered by fromDate
// zohoAccessToken is passed explicitly from main()
async function getZohoData(zohoAccessToken, fromDate) {
    const workbookurl = `https://sheet.zoho.in/api/v2/workbooks?method=workbook.list&sort_option=recently_modified`;
    const workbookresponse = await axios.get(workbookurl, {
        headers: { Authorization: `Zoho-oauthtoken ${zohoAccessToken}` }
    });
    const workbooks = workbookresponse.data.workbooks;

    if (!workbooks || workbooks.length === 0) {
        console.log('[ZohoETL] No workbooks found in Zoho API response.');
        return [];
    }
    console.log('[ZohoETL] Total workbooks fetched:', workbooks.length);

    // Filter workbooks by name and modified time >= fromDate
    const now = new Date();
    console.log(`[ZohoETL] Filtering workbooks modified between ${fromDate.toISOString()} and ${now.toISOString()}`);

    const filteredWorkbooks = workbooks.filter(workbook => {
        const hasCorrectName = workbook.workbook_name.toLowerCase().includes('intervention feedback form');
        const modifiedTime = new Date(workbook.last_modified_time);
        const isModifiedAfterFromDate = modifiedTime >= fromDate && modifiedTime <= now;
        return hasCorrectName && isModifiedAfterFromDate;
    });

    if (filteredWorkbooks.length === 0) {
        console.log('[ZohoETL] No workbooks matched name + date criteria.');
        return [];
    }
    console.log('[ZohoETL] Workbooks matching criteria:', filteredWorkbooks.length);

    // Fetch records from each matched workbook
    const recordFetchPromises = filteredWorkbooks.map(workbook => {
        const recordsUrl = `https://sheet.zoho.in/api/v2/${workbook.resource_id}?method=worksheet.records.fetch&worksheet_name=Sheet1&criteria=("Response Status"="COMPLETED")`;
        return axios.get(recordsUrl, {
            headers: { Authorization: `Zoho-oauthtoken ${zohoAccessToken}` }
        });
    });

    const responses = await Promise.all(recordFetchPromises);
    const allRecords = responses.flatMap(response => (response.data && response.data.records) || []);
    console.log('[ZohoETL] Total records fetched:', allRecords.length);

    if (allRecords.length === 0) {
        console.log('[ZohoETL] No records found in the matched workbooks.');
        return [];
    }

    // Filter records by response time within [fromDate, now]
    const runEndTime = new Date();
    console.log(`[ZohoETL] Filtering records with response time between ${fromDate.toISOString()} and ${runEndTime.toISOString()}`);

    const recordsInWindow = allRecords.filter(record => {
        let responseTimeStr = record['Response end time'] || record['Response completion time'];
        if (!responseTimeStr) return false;

        // Convert "d/m/yyyy HH:mm:ss AM/PM" → JS-parseable "MM/DD/YYYY HH:mm:ss AM/PM"
        const [datePart, timePart, meridian] = responseTimeStr.split(' ');
        const [day, month, year] = datePart.split('/');
        const formattedDateStr = `${month}/${day}/${year} ${timePart} ${meridian}`;
        const responseDate = new Date(formattedDateStr);
        return responseDate >= fromDate && responseDate <= runEndTime;
    });

    // Normalise Date of Intervention from d/m/yyyy to dd-mm-yyyy
    for (const obj of recordsInWindow) {
        const raw = obj['Date of Intervention'];
        if (raw) {
            const [d, m, y] = raw.split('/');
            obj['Date of Intervention'] = `${d.padStart(2, '0')}-${m.padStart(2, '0')}-${y}`;
        }
    }

    console.log('[ZohoETL] Records in time window:', recordsInWindow.length);
    return recordsInWindow;
}


// STEP 3: Fetch lookup data from SharePoint (paginated)
async function getLookupData() {
    try {
        const baseUrl = `/sites/${process.env.LOOKUP_SITE_ID}/lists/${process.env.LOOKUP_LIST_ID}/items?expand=fields($select=field_1,field_2,field_3,field_4)`;
        let items = [];
        let url = baseUrl;

        while (url) {
            const response = await client.api(url).get();
            if (response.value && Array.isArray(response.value)) {
                items = items.concat(response.value);
            }
            url = response['@odata.nextLink'] || null;
        }
        return items;
    } catch (error) {
        console.error('[ZohoETL] CRITICAL ERROR fetching SharePoint lookup data:', error.response ? error.response.data : error.message);
        throw error;
    }
}


// STEP 4: Merge Zoho records with SharePoint lookup data
// data is passed explicitly from main()
async function mergeData(data) {
    try {
        // Split Batch ID and build Participant Name
        const dataWithIID = data.map(field => {
            const [IID, FY, Batch_UID] = field['Batch ID'].split('.');
            field['Participant Name'] = `${field['First Name']} ${field['Last Name']}`;
            return { ...field, IID, FY, 'Batch UID': Batch_UID };
        });

        // Remove unwanted fields
        const fieldsToRemove = [
            'Response completion time', 'Response start time', 'First Name', 'Last Name',
            'Response ID', 'Response URL', 'IP address', 'Response end time', 'row_index',
            'Response Time Taken', 'Time Taken to Respond', 'Response Status',
            'Statement 1', 'Statement 2', 'Statement 3', 'Statement 4', 'Statement 5',
            'Statement 6', 'Statement 7', 'Statement 8', 'Statement 9', 'Statement 10', 'Statement 11'
        ];
        dataWithIID.forEach(item => {
            fieldsToRemove.forEach(field => { if (field in item) delete item[field]; });
        });

        const uniqueIIDs = [...new Set(dataWithIID.map(item => String(item.IID).trim()))];

        const lookupData = await getLookupData();
        const lookupArray = Array.isArray(lookupData)
            ? lookupData.map(item => item?.fields).filter(Boolean)
            : [];
        console.log(`[ZohoETL] Lookup items fetched: ${lookupArray.length}`);

        const lookupMap = new Map(
            lookupArray
                .filter(item => uniqueIIDs.includes(String(item.field_3).trim()))
                .map(item => [String(item.field_3).trim(), {
                    clientName: item.field_1,
                    CUID: item.field_2,
                    interventionName: item.field_4
                }])
        );

        const finalData = dataWithIID.map(item => {
            const key = String(item.IID || '').trim();
            const lookupValues = lookupMap.get(key) || {};
            return {
                ...item,
                'Client Name': lookupValues.clientName || null,
                'CUID': lookupValues.CUID || null,
                'Intervention Name': lookupValues.interventionName || null
            };
        });

        return finalData;
    } catch (error) {
        console.error('[ZohoETL] CRITICAL ERROR in mergeData():', error?.message || error);
        throw error;
    }
}


// STEP 5: Insert merged data into SharePoint target list
// finalData is passed explicitly from main()
async function insertIntoSharePoint(finalData) {
    const batchSize = 20;
    const failedItems = [];

    try {
        console.log('[ZohoETL] Total records to insert:', finalData.length);
        console.log('[ZohoETL] Starting batch insert to SharePoint...');

        for (let i = 0; i < finalData.length; i += batchSize) {
            const batch = finalData.slice(i, i + batchSize);

            for (const item of batch) {
                try {
                    const mappedFields = {
                        Title: String(item['Client Name']) || 'Data Not Found',
                        CUID: String(item['CUID']) || 'No Data',
                        Intervention_x0020_Name: String(item['Intervention Name']) || '',
                        IID: String(item['IID']) || 'No Data',
                        FY: Number(item['FY']) || 0,
                        BUID0: String(item['Batch ID']) || '',
                        Participant_x0020_Name: String(item['Participant Name']) || '',
                        Participant_x0020_Contact_x0020_: String(item['Your Official Contact number']) || '',
                        Participant_x0020_Email: String(item['Your Official Email Address']) || '',
                        Facilitator_x0020_Name: String(item['Name of Facilitator']) || '',
                        Date_x0020_of_x0020_Intervention: String(item['Date of Intervention']) || '',
                        City_x0020_of_x0020_Intervention: String(item['Location (City of Intervention)']) || '',
                        Statement_x0020_1: Number(item['Statement 1_Score']) || 0,
                        Statement_x0020_2: Number(item['Statement 2_Score']) || 0,
                        Statement_x0020_3: Number(item['Statement 3_Score']) || 0,
                        Statement_x0020_4: Number(item['Statement 4_Score']) || 0,
                        Statement_x0020_5: Number(item['Statement 5_Score']) || 0,
                        Statement_x0020_6: Number(item['Statement 6_Score']) || 0,
                        Statement_x0020_7: Number(item['Statement 7_Score']) || 0,
                        Statement_x0020_8: Number(item['Statement 8_Score']) || 0,
                        Statement_x0020_9: Number(item['Statement 9_Score']) || 0,
                        Statement_x0020_10: Number(item['Statement 10_Score']) || 0,
                        Statement_x0020_11: Number(item['Statement 11_Score']) || 0,
                        First_x0020_Learning_x0020_Takea: String(item['My first learning takeaway from the intervention.']) || '',
                        Second_x0020_Learning_x0020_Take: String(item['My second learning takeaway from the intervention.']) || '',
                        ThirdLearningTakeaway: String(item['My third learning takeaway from the intervention.']) || '',
                        What_x0020_could_x0020_be_x0020_: String(item['What could be done to make the Intervention better?']) || '',
                        Testimonial: String(item['How would you describe your experience of this workshop, and its impact on you?']) || '',
                    };

                    if (isDev) {
                        console.log(`[ZohoETL] Mapped fields for ${item['Participant Name']}:`, JSON.stringify(mappedFields, null, 2));
                    }

                    await client.api(
                        `/sites/${process.env.TARGET_SITE_ID}/lists/${process.env.TARGET_LIST_ID}/items`
                    ).post({ fields: mappedFields });

                } catch (error) {
                    console.error(`[ZohoETL] Failed to insert ${item['Participant Name']}:`, {
                        message: error.message,
                        code: error.code,
                        statusCode: error.statusCode,
                        body: error.body
                    });
                    if (error.statusCode === 403) console.error('[ZohoETL] Permission denied — check SharePoint app permissions.');
                    if (error.statusCode === 400) console.error('[ZohoETL] Invalid data format:', error.body);
                    failedItems.push({ item, error: { message: error.message, statusCode: error.statusCode, body: error.body } });
                }
            }

            // Pause between batches to avoid SharePoint throttling
            if (i + batchSize < finalData.length) {
                await new Promise(resolve => setTimeout(resolve, 1000));
            }
        }

        if (failedItems.length > 0) {
            console.error(`[ZohoETL] Completed with ${failedItems.length} failures out of ${finalData.length}.`);
            return { status: 'PartialSuccess', totalItems: finalData.length, successCount: finalData.length - failedItems.length, failedCount: failedItems.length };
        }

        console.log('[ZohoETL] All items inserted successfully.');
        return { status: 'Success', totalItems: finalData.length, successCount: finalData.length, failedCount: 0 };

    } catch (error) {
        console.error('[ZohoETL] Fatal error in insertIntoSharePoint:', error?.stack || error);
        return { status: 'Error', error: error.message, totalItems: 0, successCount: 0, failedCount: 0 };
    }
}


// STEP 6: Main entry point — orchestrates the pipeline bottom-up
// fromDate: Date — start of the data window to process.
// Defaults to today at midnight if not provided (first-run safe).
async function main(fromDate) {
    if (!fromDate || !(fromDate instanceof Date) || isNaN(fromDate.getTime())) {
        fromDate = new Date();
        fromDate.setHours(0, 0, 0, 0);
        console.log(`[ZohoETL] No valid fromDate supplied — defaulting to today at midnight: ${fromDate.toISOString()}`);
    }

    console.log(`[ZohoETL] Starting ETL process from ${fromDate.toISOString()}`);

    // Step 1: Get Zoho access token — fail fast if this doesn't work
    let zohoAccessToken;
    try {
        zohoAccessToken = await getZohoAccessToken();
        console.log('[ZohoETL] Zoho access token obtained successfully.');
    } catch (error) {
        console.error('[ZohoETL] FATAL: Could not get Zoho access token:', error.message);
        return { status: 'Error', error: `Zoho authentication failed: ${error.message}`, totalItems: 0, successCount: 0, failedCount: 0 };
    }

    // Step 2: Fetch Zoho data using the token
    let zohoData;
    try {
        zohoData = await getZohoData(zohoAccessToken, fromDate);
    } catch (error) {
        console.error('[ZohoETL] FATAL: Could not fetch Zoho data:', error.message);
        return { status: 'Error', error: `Zoho data fetch failed: ${error.message}`, totalItems: 0, successCount: 0, failedCount: 0 };
    }

    if (!zohoData || zohoData.length === 0) {
        console.log('[ZohoETL] No new records found in Zoho for the given date range — ETL complete.');
        return { status: 'Success', message: 'No new records to process', totalItems: 0, successCount: 0, failedCount: 0 };
    }
    console.log(`[ZohoETL] Fetched ${zohoData.length} records from Zoho.`);

    // Step 3: Merge with SharePoint lookup data
    let mergedData;
    try {
        mergedData = await mergeData(zohoData);
    } catch (error) {
        console.error('[ZohoETL] FATAL: Could not merge data:', error.message);
        return { status: 'Error', error: `Data merge failed: ${error.message}`, totalItems: 0, successCount: 0, failedCount: 0 };
    }

    if (!mergedData || mergedData.length === 0) {
        console.log('[ZohoETL] Merge produced no records — ETL complete.');
        return { status: 'Success', message: 'Merge produced no records', totalItems: 0, successCount: 0, failedCount: 0 };
    }
    console.log(`[ZohoETL] Merged ${mergedData.length} records with lookup data.`);

    // Step 4: Insert into SharePoint
    const result = await insertIntoSharePoint(mergedData);

    if (result.status === 'Success') {
        console.log(`[ZohoETL] Completed successfully. Processed ${result.totalItems} items.`);
    } else if (result.status === 'PartialSuccess') {
        console.log(`[ZohoETL] Partial success — ${result.successCount} succeeded, ${result.failedCount} failed.`);
    } else {
        console.error(`[ZohoETL] Failed: ${result.error}`);
    }

    return result;
}

module.exports = { main };
