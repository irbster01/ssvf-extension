// Main entry point that registers all Azure Functions
// This file imports all function handlers to ensure they are registered with the runtime

import '../CaptureIngest/index';
import '../ExportCaptures/index';
import '../ViewLogs/index';
import '../GetSubmissions/index';
import '../Attachments/index';
import '../NetSuitePO/index';

// The functions are registered via app.http() calls in their respective modules
