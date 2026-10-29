import { defaultShapeUtils } from 'tldraw'
import { UiShapeUtil } from './UiShapeUtil.tsx'

/** Custom shape utils for <Tldraw shapeUtils> (it adds the defaults itself). */
export const customShapeUtils = [UiShapeUtil]

/** Full set for useSync's store schema, which does not add the defaults when shapeUtils is given. */
export const syncShapeUtils = [...defaultShapeUtils, ...customShapeUtils]
