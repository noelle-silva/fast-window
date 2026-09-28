package main

import (
	"fmt"
	"sort"
	"strings"
)

// 引用关系查看：在引用索引（全仓库唯一的事实源：谁引用了谁）上做图遍历，
// 以「关注笔记 + 半径（跳数）+ 方向」为条件返回关系子图。
// 方向缺省 both（主动引用与被引用都展开），可指定 outgoing（只看主动引用）或 incoming（只看被引用）。

// refRelationNode 是关系子图中的一个笔记节点；distance 为距关注点的最少跳数（关注点自身为 0）。
type refRelationNode struct {
	NoteID   string `json:"noteId"`
	Distance int    `json:"distance"`
}

// refRelationEdge 是关系子图中真实存在的一条引用边：来源笔记的来源面带 → 目标笔记（可选目标面）。
type refRelationEdge struct {
	FromNoteID string `json:"fromNoteId"`
	FromFaceID string `json:"fromFaceId,omitempty"`
	ToNoteID   string `json:"toNoteId"`
	ToFaceID   string `json:"toFaceId,omitempty"`
}

// refRelationResult 是关系子图：半径内可达的全部笔记（含关注点）与这些笔记之间真实存在的全部引用边。
type refRelationResult struct {
	Nodes []refRelationNode `json:"nodes"`
	Edges []refRelationEdge `json:"edges"`
}

// queryRefRelations 以 noteID 为关注点按 radius 跳扩展关系子图：
// direction 为 both（缺省）时向出链与被引用两侧展开，outgoing 只看主动引用，incoming 只看被引用；
// radius 缺省（<=0）按 1 跳。关注笔记必须真实存在，否则快速失败并明示；
// 返回子图包含关注点自身与子图内诱导出的全部引用边。
func (svc *service) queryRefRelations(scope string, noteID string, radius int, direction string) (refRelationResult, error) {
	focus := strings.TrimSpace(noteID)
	if focus == "" {
		return refRelationResult{}, fmt.Errorf("缺少笔记标识")
	}
	if radius <= 0 {
		radius = 1
	}
	dir := strings.ToLower(strings.TrimSpace(direction))
	if dir == "" {
		dir = "both"
	}
	switch dir {
	case "both", "outgoing", "incoming":
	default:
		return refRelationResult{}, fmt.Errorf("未知关系方向：%s（可选 both/outgoing/incoming）", direction)
	}

	noteIdx, err := svc.loadNoteIndex(scope)
	if err != nil {
		return refRelationResult{}, err
	}
	if _, ok := noteIdx.Notes[focus]; !ok {
		return refRelationResult{}, fmt.Errorf("笔记不存在：%s", focus)
	}
	idx, err := svc.loadRefIndex(scope)
	if err != nil {
		return refRelationResult{}, err
	}
	outgoing := map[string][]refRelationEdge{}
	incoming := map[string][]refRelationEdge{}
	for fromNote, faces := range idx {
		for fromFace, refs := range faces {
			for _, ref := range refs {
				edge := refRelationEdge{FromNoteID: fromNote, FromFaceID: fromFace, ToNoteID: ref.NoteID, ToFaceID: ref.FaceID}
				outgoing[fromNote] = append(outgoing[fromNote], edge)
				incoming[ref.NoteID] = append(incoming[ref.NoteID], edge)
			}
		}
	}

	distance := map[string]int{focus: 0}
	queue := []string{focus}
	for len(queue) > 0 {
		current := queue[0]
		queue = queue[1:]
		currentDistance := distance[current]
		if currentDistance >= radius {
			continue
		}
		if dir != "incoming" {
			for _, edge := range outgoing[current] {
				if _, seen := distance[edge.ToNoteID]; !seen {
					distance[edge.ToNoteID] = currentDistance + 1
					queue = append(queue, edge.ToNoteID)
				}
			}
		}
		if dir != "outgoing" {
			for _, edge := range incoming[current] {
				if _, seen := distance[edge.FromNoteID]; !seen {
					distance[edge.FromNoteID] = currentDistance + 1
					queue = append(queue, edge.FromNoteID)
				}
			}
		}
	}

	result := refRelationResult{Nodes: []refRelationNode{}, Edges: []refRelationEdge{}}
	for id, hops := range distance {
		result.Nodes = append(result.Nodes, refRelationNode{NoteID: id, Distance: hops})
	}
	sort.Slice(result.Nodes, func(i, j int) bool {
		if result.Nodes[i].Distance != result.Nodes[j].Distance {
			return result.Nodes[i].Distance < result.Nodes[j].Distance
		}
		return result.Nodes[i].NoteID < result.Nodes[j].NoteID
	})
	for fromNote, edges := range outgoing {
		if _, ok := distance[fromNote]; !ok {
			continue
		}
		for _, edge := range edges {
			if _, ok := distance[edge.ToNoteID]; !ok {
				continue
			}
			result.Edges = append(result.Edges, edge)
		}
	}
	sort.Slice(result.Edges, func(i, j int) bool {
		a, b := result.Edges[i], result.Edges[j]
		if a.FromNoteID != b.FromNoteID {
			return a.FromNoteID < b.FromNoteID
		}
		if a.FromFaceID != b.FromFaceID {
			return a.FromFaceID < b.FromFaceID
		}
		if a.ToNoteID != b.ToNoteID {
			return a.ToNoteID < b.ToNoteID
		}
		return a.ToFaceID < b.ToFaceID
	})
	return result, nil
}
