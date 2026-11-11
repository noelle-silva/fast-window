// 输入区底栏动作列（停止 / 发送）的固定度量。
//
// 这两个按钮竖着叠起来的高度，同时就是左侧工具条的高度下限：
// 停止按钮来去两趟，底栏不该跟着跳一下。数值集中从这里推导，
// 别处只读常量，不要在两处各写一个数字慢慢对不上。

/** 动作按钮高度。停止与发送共用，好让「两行加起来」是个确定值。 */
export const COMPOSER_ACTION_BUTTON_HEIGHT = 36

/** 动作按钮宽度。停止与发送同宽，竖排才看着是一条线。 */
export const COMPOSER_ACTION_BUTTON_WIDTH = 76

/** 停止与发送之间的竖向间距。 */
export const COMPOSER_ACTION_BUTTON_GAP = 6

/** 动作列总高：左侧工具条锁死的高度下限。 */
export const COMPOSER_ACTION_COLUMN_HEIGHT =
  COMPOSER_ACTION_BUTTON_HEIGHT * 2 + COMPOSER_ACTION_BUTTON_GAP
