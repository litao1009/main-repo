package logging

import (
	"encoding/json"
)

func ExtractIDsFromBody(body []byte) (taskID, sessionID string) {
	if len(body) == 0 {
		return "", ""
	}

	var obj map[string]interface{}
	if err := json.Unmarshal(body, &obj); err != nil {
		return "", ""
	}

	if v, ok := obj["task_id"].(string); ok && v != "" {
		taskID = v
	}
	if v, ok := obj["taskId"].(string); ok && v != "" {
		taskID = v
	}
	if v, ok := obj["session_id"].(string); ok && v != "" {
		sessionID = v
	}
	if v, ok := obj["sessionId"].(string); ok && v != "" {
		sessionID = v
	}

	if data, ok := obj["data"].(map[string]interface{}); ok {
		if taskID == "" {
			if v, ok := data["task_id"].(string); ok && v != "" {
				taskID = v
			}
			if v, ok := data["taskId"].(string); ok && v != "" {
				taskID = v
			}
		}
		if sessionID == "" {
			if v, ok := data["session_id"].(string); ok && v != "" {
				sessionID = v
			}
			if v, ok := data["sessionId"].(string); ok && v != "" {
				sessionID = v
			}
		}
	}

	return taskID, sessionID
}

func ExtractIDsFromRespBody(body []byte) (taskID, sessionID string) {
	return ExtractIDsFromBody(body)
}
