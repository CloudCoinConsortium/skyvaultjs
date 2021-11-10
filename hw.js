export const foo = "I’m a module";  // allowed
const index = 0;
if (index === 0) {
	    export index; // NOT allowed
}
