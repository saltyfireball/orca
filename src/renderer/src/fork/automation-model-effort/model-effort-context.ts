import { createContext } from 'react'

/** Fork (BAD-704): a form that saves a model and effort wraps its agent picker in this, so the
 *  picker's launch-default fields show those rows without a prop through stock `AgentLaunchPicker`
 *  (which sits at its line limit). */
export const ForkModelEffortContext = createContext(false)
