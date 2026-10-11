import MindMap from 'simple-mind-map'
import Drag from 'simple-mind-map/src/plugins/Drag.js'
import MindMapLayoutPro from 'simple-mind-map/src/plugins/MindMapLayoutPro.js'
import Select from 'simple-mind-map/src/plugins/Select.js'
import 'simple-mind-map/dist/simpleMindMap.esm.css'

/**
 * 思维导图引擎装配：导图库为插件化架构，核心只带基础能力（增删改节点、快捷键、撤销重做、
 * 展开收起、缩放平移、主题、文本编辑等均在核心），以下按本面能力面按需注册：
 * - Drag：节点拖拽（左键）。
 * - Select：左键框选多选。
 * - MindMapLayoutPro：思维导图布局的左右分支方向落数据，增删节点时分支不左右乱跳。
 * 其余插件（富文本、公式、关联线、外框、小地图、导出、搜索替换等）与当前面能力无关，不引入；
 * 富文本会改变节点文本形态，影响面的引用/搜索语义，尤其不能引入。
 */
MindMap.usePlugin(Drag)
MindMap.usePlugin(Select)
MindMap.usePlugin(MindMapLayoutPro)

export { MindMap }
