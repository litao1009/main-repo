package handler

import (
	"bytes"
	"context"
	"encoding/json"
	"fmt"
	"log"
	"net/http"
	"net/url"
	"strings"

	"github.com/claw-studio/L3_AI_BFF/middleware"
	"github.com/claw-studio/L3_AI_BFF/model"
	"github.com/claw-studio/L3_AI_BFF/pkg/validator"
	"github.com/claw-studio/L3_AI_BFF/proxy"
	"clawstudios/pkg/logging"
	"github.com/gin-gonic/gin"
)

func PublishTask(publishURL, sessionMgrURL, accountURL string) gin.HandlerFunc {
	return func(c *gin.Context) {
		tid := c.Param("tid")
		uidVal, _ := c.Get("uid")
		roleVal, _ := c.Get("role")

		logger := middleware.GetBFFLogger(c)
		if logger != nil {
			logger.Info("收到发布请求 tid=%s uid=%v role=%v", tid, uidVal, roleVal)
		}

		if !validator.IsValidTaskID(tid) {
			if logger != nil {
				logger.Warn(logging.ErrInvalidParam, "发布请求: 任务ID格式不合法: %s", tid)
			}
			model.Error(c, model.ErrInvalidParam.WithDetail("任务 ID 格式不合法"))
			return
		}

		var req model.PublishReq
		if err := c.ShouldBindJSON(&req); err != nil {
			if logger != nil {
				logger.Warn(logging.ErrInvalidParam, "发布请求: JSON解析失败: %v", err)
			}
			model.Error(c, model.ErrInvalidParam.WithDetail("请求体格式错误"))
			return
		}

		bffTID, _ := c.Get(model.TraceIDKey)
		bffUID, _ := c.Get("uid")
		bffRole, _ := c.Get("role")

		var accounts []map[string]string
		platform := req.Platform

		if len(req.Accounts) > 0 {
			if logger != nil {
				logger.Info("前端指定发布账号: %v", req.Accounts)
			}
			uidForLookup := bffUID.(string)
			if bffRole == "admin" {
				uidForLookup = ""
			}
			allUserAccounts := fetchUserAccounts(accountURL, uidForLookup, platform, bffUID.(string), bffRole.(string))
			userAccountSet := make(map[string]string)
			for _, a := range allUserAccounts {
				userAccountSet[a.AccountID] = a.Platform
			}
			for _, accID := range req.Accounts {
				accPlatform, ok := userAccountSet[accID]
				if bffRole != "admin" && !ok {
					if logger != nil {
						logger.Warn(logging.ErrInvalidParam, "发布请求: 账号 %s 不属于当前用户", accID)
					}
					model.Error(c, model.ErrInvalidParam.WithDetail(
						fmt.Sprintf("账号 %s 不属于当前用户或未绑定", accID)))
					return
				}
				if !ok {
					accPlatform = platform
				}
				accounts = append(accounts, map[string]string{
					"accountId": accID,
					"uid":       bffUID.(string),
					"platform":  accPlatform,
				})
				if platform == "" {
					platform = accPlatform
				}
			}
		} else {
			uidForLookup := bffUID.(string)
			if bffRole == "admin" {
				uidForLookup = ""
			}
			realAccounts := fetchUserAccounts(accountURL, uidForLookup, platform, bffUID.(string), bffRole.(string))
			if logger != nil {
				logger.Info("查询用户账号 uid=%q platform=%q 结果数=%d", uidForLookup, platform, len(realAccounts))
			}
			if len(realAccounts) == 0 {
				if logger != nil {
					logger.Warn(logging.ErrInvalidParam, "发布请求: uid=%q platform=%q 无可用账号", uidForLookup, platform)
				}
				model.Error(c, model.ErrInvalidParam.WithDetail(
					fmt.Sprintf("没有绑定 %s 平台的账号，请先在账号配置页面绑定", platform)))
				return
			}
			accounts = make([]map[string]string, 0, len(realAccounts))
			for _, a := range realAccounts {
				accounts = append(accounts, map[string]string{
					"accountId": a.AccountID,
					"uid":       bffUID.(string),
					"platform":  a.Platform,
				})
			}
			if platform == "" && len(accounts) > 0 {
				platform = fmt.Sprint(accounts[0]["platform"])
			}
		}

		downstream := map[string]interface{}{
			"draftVersion":  req.DraftVersion,
			"sessionId":     req.SessionID,
			"platform":      platform,
			"accounts":      accounts,
			"skillId":       req.SkillID,
			"topic":         req.Topic,
			"taskId":        tid + "_" + req.SessionID,
			"novelName":     req.NovelName,
			"title":         req.Title,
			"volumeName":    req.VolumeName,
			"chapterNumber": req.ChapterNumber,
			"uid":           bffUID,
			"traceId":       bffTID,
		}

		url := formatURL(publishURL, "/"+tid+"/publish")
		// 发布可能耗时 2-3 分钟，使用独立 context 防止请求上下文提前取消
		c.Request = c.Request.WithContext(context.Background())
		respBody, statusCode, err := proxy.Forward(c, url, downstream)
		if err != nil {
			model.Error(c, model.ErrUpstreamUnavailable.WithDetail(err.Error()))
			return
		}

		if statusCode >= 200 && statusCode < 300 && sessionMgrURL != "" {
			go func() {
				defer func() {
					if r := recover(); r != nil {
						logger := middleware.GetBFFLogger(c)
						if logger != nil {
							logger.Error(logging.ErrInternal, "updateTaskOnSessionMgr panic: task=%s err=%v", tid, r)
						}
					}
				}()
				updateTaskOnSessionMgr(sessionMgrURL, tid, req.NovelName, req.VolumeName, req.Title, req.ChapterNumber)
			}()
		}

		proxy.HandleDownstreamResponse(c, respBody, statusCode, "workflow", func(c *gin.Context, data []byte) {
			c.Header("Content-Type", "application/json")
			c.String(200, string(data))
		})
	}
}

type accountInfo struct {
	AccountID string `json:"account_id"`
	UID       string `json:"uid"`
	Platform  string `json:"platform"`
}

// fetchUserAccounts 查询 A1 账号列表。admin 查全量时需传 operatorUID+role，与 AccountProxy 行为一致。
func fetchUserAccounts(accountURL, lookupUID, platform, operatorUID, role string) []accountInfo {
	listURL := strings.TrimSuffix(accountURL, "/") + "/api/account/list"
	query := url.Values{}
	if lookupUID != "" {
		query.Set("uid", lookupUID)
	}
	if platform != "" {
		query.Set("platform", platform)
	}
	if role == "admin" && lookupUID == "" {
		query.Set("limit", "100")
	}
	if encoded := query.Encode(); encoded != "" {
		listURL += "?" + encoded
	}

	req, err := http.NewRequest(http.MethodGet, listURL, nil)
	if err != nil {
		return nil
	}
	headerUID := lookupUID
	if headerUID == "" {
		headerUID = operatorUID
	}
	if headerUID != "" {
		req.Header.Set("X-User-ID", headerUID)
	}
	if role != "" {
		req.Header.Set("X-User-Role", role)
	}

	resp, err := http.DefaultClient.Do(req)
	if err != nil {
		return nil
	}
	defer resp.Body.Close()
	if resp.StatusCode < 200 || resp.StatusCode >= 300 {
		return nil
	}
	var result struct {
		Accounts []accountInfo `json:"accounts"`
	}
	if err := json.NewDecoder(resp.Body).Decode(&result); err != nil {
		return nil
	}
	return result.Accounts
}

func updateTaskOnSessionMgr(sessionMgrURL, taskID, novelName, volumeName, chapterTitle string, chapterNumber int) {
	url := sessionMgrURL + "/api/task/" + taskID + "/update"
	body := map[string]interface{}{
		"novel_name":     novelName,
		"volume_name":    volumeName,
		"title":          chapterTitle,
		"chapter_number": chapterNumber,
	}
	data, err := json.Marshal(body)
	if err != nil {
		return
	}
	req, err := http.NewRequest("POST", url, bytes.NewReader(data))
	if err != nil {
		return
	}
	req.Header.Set("Content-Type", "application/json")
	resp, err := http.DefaultClient.Do(req)
	if err != nil {
		log.Printf("[publish] failed to update task on session_mgr: %v", err)
		return
	}
	defer resp.Body.Close()
	log.Printf("[publish] updated task %s novel_name=%q on session_mgr: status=%d", taskID, novelName, resp.StatusCode)
}
