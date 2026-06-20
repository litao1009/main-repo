package handler

import (
	"database/sql"
	"strings"

	"github.com/claw-studio/L3_AI_BFF/model"
	"github.com/claw-studio/L3_AI_BFF/pkg/validator"
	"github.com/gin-gonic/gin"
)

type accountOccupancy struct {
	Occupied  bool   `json:"occupied"`
	TaskID    string `json:"task_id,omitempty"`
	NovelName string `json:"novel_name,omitempty"`
	Message   string `json:"message,omitempty"`
}

func fanqieAccountOccupiedMessage(novelName string) string {
	name := strings.TrimSpace(novelName)
	if name == "" {
		name = "未命名小说"
	}
	return "番茄账号已绑定小说「" + name + "」，番茄平台每个账号仅支持创建一本小说"
}

func lookupFanqieAccountOccupancy(sessionMgrURL string, taskMgr *TaskManager, accountID string) accountOccupancy {
	tasks, err := fetchAllTasksFromSessionMgr(sessionMgrURL, "", "")
	if err != nil {
		return accountOccupancy{Occupied: false}
	}

	for _, t := range tasks {
		platform, _ := t["platform"].(string)
		if platform != "fanqie" {
			continue
		}
		acc, _ := t["account_id"].(string)
		if acc != accountID {
			continue
		}
		taskID, _ := t["task_id"].(string)
		if taskID != "" && taskMgr != nil && isAutoPublishTaskDeleted(taskMgr, taskID) {
			continue
		}
		novelName, _ := t["novel_name"].(string)
		return accountOccupancy{
			Occupied:  true,
			TaskID:    taskID,
			NovelName: strings.TrimSpace(novelName),
			Message:   fanqieAccountOccupiedMessage(novelName),
		}
	}
	return accountOccupancy{Occupied: false}
}

func isAutoPublishTaskDeleted(taskMgr *TaskManager, taskID string) bool {
	var status string
	err := taskMgr.db.QueryRow(`SELECT status FROM auto_publish_task WHERE task_id=?`, taskID).Scan(&status)
	if err == sql.ErrNoRows {
		return false
	}
	if err != nil {
		return false
	}
	return status == "deleted"
}

// CheckAccountOccupancy 按 account_id 全局检查番茄账号是否已有未删除的小说任务。
func CheckAccountOccupancy(sessionMgrURL string, taskMgr *TaskManager) gin.HandlerFunc {
	return func(c *gin.Context) {
		platform := c.Query("platform")
		accountID := c.Query("account_id")

		if platform == "" {
			model.Error(c, model.ErrInvalidParam.WithDetail("platform 不能为空"))
			return
		}
		if platform != "fanqie" {
			tid, _ := c.Get(model.TraceIDKey)
			c.JSON(200, model.APIResponse{
				Code:    0,
				Message: "ok",
				Data:    accountOccupancy{Occupied: false},
				TraceID: tid.(string),
			})
			return
		}
		if accountID == "" {
			model.Error(c, model.ErrInvalidParam.WithDetail("account_id 不能为空"))
			return
		}
		avr := validator.ValidateAccountIDs([]string{accountID})
		if !avr.Valid {
			model.Error(c, model.ErrInvalidParam.WithDetail(avr.Errors))
			return
		}

		result := lookupFanqieAccountOccupancy(sessionMgrURL, taskMgr, accountID)

		tid, _ := c.Get(model.TraceIDKey)
		c.JSON(200, model.APIResponse{
			Code:    0,
			Message: "ok",
			Data:    result,
			TraceID: tid.(string),
		})
	}
}
